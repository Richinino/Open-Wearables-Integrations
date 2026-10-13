from owi.models import SHEALTH_SOURCE, SourceRef


def test_samsung_health_app_means_health_connect_provider_and_shealth_source():
    assert SourceRef("google", SHEALTH_SOURCE).is_samsung_health_app
    assert SourceRef("health_connect", SHEALTH_SOURCE).is_samsung_health_app
    assert not SourceRef("samsung", SHEALTH_SOURCE).is_samsung_health_app
    assert not SourceRef("google", "com.android.healthconnect.phone.abc").is_samsung_health_app


def test_provider_kinds():
    assert SourceRef("google").is_health_connect
    assert SourceRef("health_connect").is_health_connect
    assert SourceRef("samsung").is_samsung_direct
    assert not SourceRef("samsung").is_health_connect
