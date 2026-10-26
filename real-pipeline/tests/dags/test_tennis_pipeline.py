from airflow.models import DagBag


def test_real_dag_imports_and_six_task_chain():
    bag = DagBag(dag_folder="/opt/airflow/dags", include_examples=False)
    assert not bag.import_errors, bag.import_errors
    pipeline = bag.get_dag("tennis_tournament_pipeline")
    assert pipeline is not None
    expected = ["extract", "validate", "transform", "load", "standings", "report"]
    assert set(pipeline.task_ids) == set(expected)
    for first, second in zip(expected, expected[1:]):
        assert pipeline.get_task(first).downstream_task_ids == {second}
    assert pipeline.max_active_runs == 1
