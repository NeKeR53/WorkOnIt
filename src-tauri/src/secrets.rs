use std::collections::BTreeMap;
use thiserror::Error;

const SERVICE: &str = "WorkOnIt";

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("Le coffre de secrets est indisponible : {0}")]
    Keyring(#[from] keyring::Error),
}

pub trait SecretStore {
    fn set(&self, logical_name: &str, value: &str) -> Result<(), SecretError>;
    fn get(&self, logical_name: &str) -> Result<String, SecretError>;
    fn delete(&self, logical_name: &str) -> Result<(), SecretError>;
}

pub struct OsSecretStore;

impl SecretStore for OsSecretStore {
    fn set(&self, logical_name: &str, value: &str) -> Result<(), SecretError> {
        Ok(entry(logical_name)?.set_password(value)?)
    }

    fn get(&self, logical_name: &str) -> Result<String, SecretError> {
        Ok(entry(logical_name)?.get_password()?)
    }

    fn delete(&self, logical_name: &str) -> Result<(), SecretError> {
        Ok(entry(logical_name)?.delete_credential()?)
    }
}

fn entry(logical_name: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, logical_name)
}

pub fn resolve(
    store: &impl SecretStore,
    logical_names: &[String],
) -> Result<BTreeMap<String, String>, SecretError> {
    logical_names
        .iter()
        .map(|name| store.get(name).map(|value| (name.clone(), value)))
        .collect()
}

pub fn redact(text: &str, secrets: impl IntoIterator<Item = String>) -> String {
    let mut redacted = text.to_owned();
    for secret in secrets {
        if !secret.is_empty() {
            redacted = redacted.replace(&secret, "••••••••");
        }
    }
    redacted
}

pub fn environment_name(logical_name: &str) -> String {
    let normalized: String = logical_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("WORKONIT_SECRET_{normalized}")
}
