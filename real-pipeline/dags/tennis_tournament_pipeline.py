"""Real CSV -> Postgres ETL with one intentional, successful half-batch load."""

import csv
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from airflow.sdk import dag, task, get_current_context

LOG = logging.getLogger(__name__)
REQUIRED = ("tourney_name", "tourney_date", "winner_name", "loser_name", "score")
RAW_FILE = Path(os.environ.get("TENNIS_CSV_PATH", "/opt/airflow/data/raw/atp_matches_2023.csv"))
STAGING = Path("/opt/airflow/include/staging")


def database():
    import psycopg

    # Compose's local-only development Postgres; never touch Airflow's public tables.
    return psycopg.connect(host=os.environ["PGHOST"], port=os.environ["PGPORT"],
                           dbname=os.environ["PGDATABASE"], user=os.environ["PGUSER"],
                           password=os.environ["PGPASSWORD"])


def initialize_warehouse(connection):
    connection.execute("CREATE SCHEMA IF NOT EXISTS warehouse")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS warehouse.run_metadata (
            run_id TEXT PRIMARY KEY,
            dag_id TEXT NOT NULL,
            source_file TEXT NOT NULL,
            extracted_rows BIGINT NOT NULL,
            extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            loaded_rows BIGINT,
            loaded_at TIMESTAMPTZ,
            reported_at TIMESTAMPTZ
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS warehouse.matches (
            run_id TEXT NOT NULL REFERENCES warehouse.run_metadata(run_id),
            match_index INTEGER NOT NULL,
            tourney_name TEXT,
            tourney_date DATE,
            winner_name TEXT,
            loser_name TEXT,
            score TEXT,
            payload JSONB NOT NULL,
            PRIMARY KEY (run_id, match_index)
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS warehouse.player_wins (
            player TEXT PRIMARY KEY,
            wins BIGINT NOT NULL
        )
    """)


def save_stage(name, payload, run_id):
    directory = STAGING / hashlib.sha256(run_id.encode()).hexdigest()[:20]
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{name}.json"
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    temporary.replace(destination)
    return str(destination)


def read_stage(filename):
    return json.loads(Path(filename).read_text(encoding="utf-8"))


@dag(
    dag_id="tennis_tournament_pipeline",
    start_date=datetime(2023, 1, 1, tzinfo=timezone.utc),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    default_args={"owner": "bug-quest", "retries": 2},
    tags=["tennis", "warehouse", "planted-bug"],
)
def tennis_tournament_pipeline():
    @task
    def extract():
        run_id = get_current_context()["run_id"]
        with RAW_FILE.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            columns = reader.fieldnames or []
            rows = list(reader)
        if not rows:
            raise ValueError("The ATP CSV contains no matches.")
        LOG.info("Extracted %d matches from %s", len(rows), RAW_FILE.name)
        with database() as connection:
            initialize_warehouse(connection)
            connection.execute("""
                INSERT INTO warehouse.run_metadata (run_id, dag_id, source_file, extracted_rows)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (run_id) DO UPDATE SET extracted_rows = EXCLUDED.extracted_rows,
                    extracted_at = NOW(), loaded_rows = NULL, loaded_at = NULL, reported_at = NULL
            """, (run_id, "tennis_tournament_pipeline", RAW_FILE.name, len(rows)))
        # XCom carries a small filename, not thousands of full match records.
        return save_stage("extracted", {"run_id": run_id, "columns": columns, "rows": rows}, run_id)

    @task
    def validate(extracted_path):
        data = read_stage(extracted_path)
        missing = sorted(set(REQUIRED) - set(data["columns"]))
        if missing:
            raise ValueError(f"Missing required columns: {missing}")
        nulls = {column: sum(not (row.get(column) or "").strip() for row in data["rows"]) for column in REQUIRED}
        LOG.info("Validated required columns; null/blank counts: %s", nulls)
        return extracted_path

    @task
    def transform(validated_path):
        data = read_stage(validated_path)
        cleaned = []
        for raw in data["rows"]:
            row = {re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_"): (value.strip() if isinstance(value, str) else value) for key, value in raw.items()}
            row["tourney_date"] = datetime.strptime(row["tourney_date"], "%Y%m%d").date().isoformat()
            cleaned.append(row)
        LOG.info("Transformed %d matches; tournament dates parsed as dates", len(cleaned))
        return save_stage("transformed", {"run_id": data["run_id"], "rows": cleaned}, data["run_id"])

    @task
    def load(transformed_path):
        from psycopg.types.json import Jsonb

        data = read_stage(transformed_path)
        matches = data["rows"]
        # PLANTED BUG: accidental page-size limit silently drops the second half.
        matches_to_load = matches[:len(matches) // 2]
        with database() as connection:
            connection.execute("TRUNCATE TABLE warehouse.matches")
            with connection.cursor().copy("""
                COPY warehouse.matches (run_id, match_index, tourney_name, tourney_date,
                    winner_name, loser_name, score, payload) FROM STDIN
            """) as copy:
                for index, row in enumerate(matches_to_load):
                    copy.write_row((data["run_id"], index, row["tourney_name"], datetime.fromisoformat(row["tourney_date"]).date(), row["winner_name"] or None, row["loser_name"] or None, row["score"] or None, Jsonb(row)))
            connection.execute("UPDATE warehouse.run_metadata SET loaded_rows = %s, loaded_at = NOW() WHERE run_id = %s", (len(matches_to_load), data["run_id"]))
        LOG.info("Loaded %d matches into warehouse.matches", len(matches_to_load))
        return data["run_id"]

    @task
    def standings(pipeline_run_id):
        run_id = pipeline_run_id
        with database() as connection:
            connection.execute("TRUNCATE TABLE warehouse.player_wins")
            connection.execute("""
                INSERT INTO warehouse.player_wins (player, wins)
                SELECT winner_name, COUNT(*) FROM warehouse.matches
                WHERE run_id = %s AND winner_name IS NOT NULL GROUP BY winner_name
            """, (run_id,))
            players = connection.execute("SELECT COUNT(*) FROM warehouse.player_wins").fetchone()[0]
        LOG.info("Built standings for %d players", players)
        return run_id

    @task
    def report(pipeline_run_id):
        run_id = pipeline_run_id
        with database() as connection:
            extracted = connection.execute("SELECT extracted_rows FROM warehouse.run_metadata WHERE run_id = %s", (run_id,)).fetchone()[0]
            loaded = connection.execute("SELECT COUNT(*) FROM warehouse.matches WHERE run_id = %s", (run_id,)).fetchone()[0]
            wins = connection.execute("SELECT COALESCE(SUM(wins), 0) FROM warehouse.player_wins").fetchone()[0]
            connection.execute("UPDATE warehouse.run_metadata SET reported_at = NOW() WHERE run_id = %s", (run_id,))
        # Log counts only: the external checker exposes the silent row loss.
        LOG.info("Final counts: extracted=%d, matches_loaded=%d, total_player_wins=%d", extracted, loaded, wins)
        return {"run_id": run_id, "extracted_rows": extracted, "matches_loaded": loaded, "total_wins": int(wins)}

    report(standings(load(transform(validate(extract())))))


tennis_tournament_pipeline()
