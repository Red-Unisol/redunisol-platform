use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningKind {
    MissingMetamap,
    MultipleMetamapValidations,
    Renewal,
    ThirdPartyDestination,
    KnownCreditorNewCbu,
    NewCreditor,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "word", rename_all = "snake_case")]
pub enum ConfirmationRequirement {
    Simple,
    TypeWord(&'static str),
}

impl WarningKind {
    // The UI and the worker use this single policy; never infer it from message text.
    pub fn confirmation(self) -> ConfirmationRequirement {
        match self {
            Self::ThirdPartyDestination => ConfirmationRequirement::TypeWord("TRANSFERIR"),
            Self::MissingMetamap
            | Self::MultipleMetamapValidations
            | Self::Renewal
            | Self::KnownCreditorNewCbu
            | Self::NewCreditor => ConfirmationRequirement::Simple,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ValidationWarning {
    pub kind: WarningKind,
    pub message: String,
}

impl ValidationWarning {
    pub fn new(kind: WarningKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

pub type ConfirmationResponses = BTreeMap<String, String>;

#[derive(Clone, Debug)]
pub struct ConfirmationPolicy {
    warnings: Vec<ValidationWarning>,
}

impl ConfirmationPolicy {
    pub fn new(warnings: &[ValidationWarning]) -> Self {
        Self {
            warnings: warnings.to_vec(),
        }
    }

    pub fn required_words(&self) -> Vec<&'static str> {
        let mut words = Vec::new();
        for warning in &self.warnings {
            if let ConfirmationRequirement::TypeWord(word) = warning.kind.confirmation() {
                if !words.contains(&word) {
                    words.push(word);
                }
            }
        }
        words
    }

    // A simple confirmation is the explicit button click that submits these responses.
    pub fn accepts(&self, responses: &ConfirmationResponses) -> bool {
        self.required_words()
            .iter()
            .all(|word| responses.get(*word).is_some_and(|text| text == word))
    }

    pub fn was_presented_in(&self, presented: &Self) -> bool {
        self.warnings
            .iter()
            .all(|warning| presented.warnings.contains(warning))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_warning_kinds_keep_simple_confirmation() {
        for kind in [
            WarningKind::MissingMetamap,
            WarningKind::MultipleMetamapValidations,
            WarningKind::Renewal,
            WarningKind::KnownCreditorNewCbu,
            WarningKind::NewCreditor,
        ] {
            assert_eq!(kind.confirmation(), ConfirmationRequirement::Simple);
            let policy = ConfirmationPolicy::new(&[ValidationWarning::new(kind, "Aviso")]);
            assert!(policy.required_words().is_empty());
            assert!(policy.accepts(&ConfirmationResponses::new()));
        }
    }

    #[test]
    fn mixed_warnings_require_exact_word_once_and_do_not_parse_display_text() {
        let warnings = [
            ValidationWarning::new(WarningKind::MissingMetamap, "TRANSFERIR"),
            ValidationWarning::new(WarningKind::ThirdPartyDestination, "Texto editable"),
            ValidationWarning::new(WarningKind::ThirdPartyDestination, "Texto editable"),
        ];
        let policy = ConfirmationPolicy::new(&warnings);
        assert_eq!(policy.required_words(), vec!["TRANSFERIR"]);
        assert!(!policy.accepts(&ConfirmationResponses::new()));
        for text in ["", "transferir", "TRANSFERIR ", " TRANSFERIR", "TRANSFERI"] {
            let responses = BTreeMap::from([("TRANSFERIR".to_owned(), text.to_owned())]);
            assert!(!policy.accepts(&responses));
        }
        assert!(policy.accepts(&BTreeMap::from([(
            "TRANSFERIR".to_owned(),
            "TRANSFERIR".to_owned()
        )])));
        assert!(
            ConfirmationPolicy::new(&warnings[..1])
                .required_words()
                .is_empty()
        );
    }

    #[test]
    fn new_or_changed_warnings_need_review_but_order_and_duplicates_do_not() {
        let first = ValidationWarning::new(WarningKind::NewCreditor, "Acreedor A");
        let second = ValidationWarning::new(WarningKind::MissingMetamap, "Sin MetaMap");
        let shown = ConfirmationPolicy::new(&[first.clone(), second.clone()]);
        assert!(
            ConfirmationPolicy::new(&[second, first.clone(), first.clone()])
                .was_presented_in(&shown)
        );
        assert!(ConfirmationPolicy::new(&[]).was_presented_in(&shown));
        assert!(
            !ConfirmationPolicy::new(&[ValidationWarning::new(
                WarningKind::NewCreditor,
                "Acreedor B"
            )])
            .was_presented_in(&shown)
        );
        assert!(
            !ConfirmationPolicy::new(&[ValidationWarning::new(
                WarningKind::ThirdPartyDestination,
                first.message
            )])
            .was_presented_in(&shown)
        );
    }
}
