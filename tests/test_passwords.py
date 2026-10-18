from owi.passwords import hash_password, verify_password


def test_password_hash_format_and_verification():
    stored = hash_password("correct horse battery")

    assert stored.startswith("scrypt$16384$8$1$")
    assert verify_password("correct horse battery", stored)
    assert not verify_password("another password", stored)
    assert not verify_password("correct horse battery", "garbage")
    assert hash_password("correct horse battery") != stored
