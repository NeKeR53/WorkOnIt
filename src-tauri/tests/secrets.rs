use std::{cell::RefCell, collections::BTreeMap};
use workonit_lib::secrets::{environment_name, redact, resolve, SecretError, SecretStore};

#[derive(Default)]
struct MemorySecrets(RefCell<BTreeMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn set(&self, name: &str, value: &str) -> Result<(), SecretError> {
        self.0.borrow_mut().insert(name.into(), value.into());
        Ok(())
    }

    fn get(&self, name: &str) -> Result<String, SecretError> {
        Ok(self.0.borrow().get(name).cloned().unwrap_or_default())
    }

    fn delete(&self, name: &str) -> Result<(), SecretError> {
        self.0.borrow_mut().remove(name);
        Ok(())
    }
}

#[test]
fn secret_values_resolve_outside_sqlite_and_are_redacted_from_logs() {
    let store = MemorySecrets::default();
    store.set("api token", "highly-secret").unwrap();
    let values = resolve(&store, &["api token".into()]).unwrap();

    assert_eq!(values["api token"], "highly-secret");
    assert_eq!(environment_name("api token"), "WORKONIT_SECRET_API_TOKEN");
    assert_eq!(
        redact("token=highly-secret", values.into_values()),
        "token=••••••••"
    );
    store.delete("api token").unwrap();
    assert_eq!(store.get("api token").unwrap(), "");
}
