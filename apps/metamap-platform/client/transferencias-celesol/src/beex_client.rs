//! Beex owns requests; its legacy ID is a loan ID, never a Vimarx request ID.
use crate::{
    cancellations::{CancellationPayment, TransferLeg, TransferLegKind},
    config::BeexConfig,
    models::CoreSnapshot,
};
use anyhow::{Context, Result, anyhow, bail};
use reqwest::{
    StatusCode,
    blocking::{Client, Response},
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{collections::HashSet, time::Duration};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BeexPayment {
    pub payment_key: String,
    pub kind: String,
    pub amount: String,
    pub cbu: String,
    pub cuit: String,
    pub name: String,
    // Missing numbers in old reservations must not be silently regenerated.
    #[serde(default)]
    pub bank_number: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub request_number: String,
    pub document: String,
    pub required: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct BeexMember {
    pub cuit: String,
    pub name: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BeexPlan {
    pub source: String,
    pub solicitud_id: String,
    pub nro_solicitud: Option<String>,
    pub prestamo_legacy_id: String,
    pub financial_line_id: String,
    pub currency: String,
    pub requested_amount: String,
    pub total: String,
    pub bank: String,
    pub requires_renewal_review: bool,
    pub verification: Verification,
    pub member: BeexMember,
    pub payments: Vec<BeexPayment>,
    pub version: String,
}
pub fn exact_money(raw: &str) -> Result<Decimal> {
    let (whole, cents) = raw
        .split_once('.')
        .ok_or_else(|| anyhow!("Importe Beex sin dos decimales."))?;
    if whole.is_empty()
        || cents.len() != 2
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !cents.bytes().all(|b| b.is_ascii_digit())
    {
        bail!("Importe Beex invalido; no se redondea ni convierte desde float.");
    }
    Decimal::from_str_exact(raw).context("Importe Beex fuera de rango.")
}
fn digits(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|b| b.is_ascii_digit())
}
impl BeexPlan {
    pub fn validate(&self) -> Result<()> {
        uuid::Uuid::parse_str(&self.solicitud_id)?;
        if self.source != "BEEX"
            || self.prestamo_legacy_id.is_empty()
            || !self.prestamo_legacy_id.bytes().all(|b| b.is_ascii_digit())
            || self.currency != "ARS"
            || !matches!(self.bank.as_str(), "CMF" | "COINAG")
            || self.version.len() != 64
            || !self.version.bytes().all(|b| b.is_ascii_hexdigit())
            || self.verification.request_number != self.prestamo_legacy_id
            || self
                .financial_line_id
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .is_none()
            || !matches!(self.verification.document.len(), 7 | 8)
            || !digits(&self.member.cuit, 11)
            || !self
                .verification
                .document
                .bytes()
                .all(|b| b.is_ascii_digit())
        {
            bail!("Contrato del plan Beex invalido.");
        }
        let mut keys = HashSet::new();
        let mut numbers = HashSet::new();
        let mut total = Decimal::ZERO;
        let mut members = 0;
        for p in &self.payments {
            if !keys.insert(&p.payment_key) || !digits(&p.cbu, 22) || !digits(&p.cuit, 11) {
                bail!("Destino Beex invalido o duplicado.");
            }
            match (p.kind.as_str(), p.payment_key.as_str()) {
                ("member", "member") if p.cuit == self.member.cuit => members += 1,
                ("creditor", key) => {
                    uuid::Uuid::parse_str(
                        key.strip_prefix("creditor:")
                            .ok_or_else(|| anyhow!("Clave de acreedor Beex invalida."))?,
                    )?;
                }
                _ => bail!("Pata Beex invalida."),
            }
            let number = p.bank_number.as_deref().ok_or_else(|| {
                anyhow!("Beex no devuelve bankNumber; aplicar la migracion de numeracion.")
            })?;
            bank_id("1", number)?;
            if !numbers.insert(number) {
                bail!("Numero bancario Beex duplicado.");
            }
            let amount = exact_money(&p.amount)?;
            if amount <= Decimal::ZERO {
                bail!("Pago Beex no positivo.");
            }
            total += amount;
        }
        let requested = exact_money(&self.requested_amount)?;
        if self.payments.is_empty()
            || self.payments.len() > 100
            || members > 1
            || total != exact_money(&self.total)?
            || total > requested
            || requested <= Decimal::ZERO
            || self.requires_renewal_review != (total < requested)
            || (self.payments.iter().any(|p| p.kind == "creditor") && total != requested)
        {
            bail!("Los montos del plan Beex no concilian exactamente.");
        }
        Ok(())
    }
    pub fn core(&self) -> Result<CoreSnapshot> {
        self.validate()?;
        let member = self.payments.iter().find(|p| p.kind == "member");
        let creditors = self
            .payments
            .iter()
            .filter(|p| p.kind == "creditor")
            .map(|p| {
                Ok(CancellationPayment {
                    payment_key: Some(p.payment_key.clone()),
                    id: p.bank_number.as_deref().unwrap().parse()?,
                    amount_raw: Some(p.amount.clone()),
                    amount: Some(exact_money(&p.amount)?),
                    cbu: Some(p.cbu.clone()),
                    owner_cuit: Some(p.cuit.clone()),
                    owner_name: Some(p.name.clone()),
                    ..Default::default()
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let total = exact_money(&self.total)?;
        Ok(CoreSnapshot {
            beex: Some(self.clone()),
            request_oid: format!("beex:{}", self.solicitud_id),
            request_name: Some(self.member.name.clone()),
            credit_line_id: Some(self.financial_line_id.parse()?),
            credit_line_description: Some(format!("Linea {}", self.financial_line_id)),
            request_status: Some("A Transferir".to_owned()),
            request_amount_raw: Some(self.requested_amount.clone()),
            request_amount: Some(exact_money(&self.requested_amount)?),
            request_document: Some(self.verification.document.clone()),
            request_cuil: Some(self.member.cuit.clone()),
            transfer_cbu: member.map(|p| p.cbu.clone()),
            cancellation_amount: Some(creditors.iter().filter_map(|p| p.amount).sum()),
            cancellation_detail_count: Some(creditors.len() as u64),
            cash_in_hand_amount: Some(
                member
                    .map(|p| exact_money(&p.amount))
                    .transpose()?
                    .unwrap_or_default(),
            ),
            cancellation_payments: creditors,
            bank_cmf_amount: Some(if self.bank == "CMF" {
                total
            } else {
                Decimal::ZERO
            }),
            bank_coinag_cba_amount: Some(if self.bank == "COINAG" {
                total
            } else {
                Decimal::ZERO
            }),
            ..Default::default()
        })
    }
    pub fn leg(&self, payment: &BeexPayment) -> Result<TransferLeg> {
        Ok(TransferLeg {
            key: payment.payment_key.clone(),
            kind: if payment.kind == "member" {
                TransferLegKind::Member
            } else {
                TransferLegKind::Creditor
            },
            amount: exact_money(&payment.amount)?,
            cbu: payment.cbu.clone(),
            cuit: payment.cuit.clone(),
            holder_name: Some(payment.name.clone()),
        })
    }
}
// Same numeric 15-digit suffix as legacy. Legacy normal ends in 0; legacy
// cancellation uses type 1/2 at position 8. Our type 3 AND ending 9 are disjoint.
pub fn bank_id(company: &str, number: &str) -> Result<String> {
    if company.is_empty()
        || !company.bytes().all(|b| b.is_ascii_digit())
        || number.is_empty()
        || !number.bytes().all(|b| b.is_ascii_digit())
        || number.starts_with('0')
    {
        bail!("Empresa o numero bancario Beex invalido.");
    }
    let n = number.parse::<u64>()?;
    if n == 0 || n > 9_999_999_999_999 {
        bail!("Numero bancario Beex fuera de rango.");
    }
    Ok(format!("{company}{:08}3{:05}9", n / 100_000, n % 100_000))
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub solicitud_id: String,
    pub nro_solicitud: Option<String>,
    pub desembolso: Option<OrderReference>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct OrderReference {
    pub id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    items: Vec<Candidate>,
    next_cursor: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReservationPayment {
    pub payment_key: String,
    pub bank_transaction_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub idempotency_key: String,
    pub plan_version: String,
    pub installation_id: String,
    pub operator: String,
    pub verification_id: Option<String>,
    pub payments: Vec<ReservationPayment>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Confirmation {
    pub installation_id: String,
    pub operator: String,
    pub bank_transaction_id: String,
    pub bank_operation_id: String,
    pub amount: String,
    pub currency: String,
    pub cbu: String,
    pub cuit: String,
    pub confirmed_at: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderPayment {
    pub payment_key: String,
    pub bank_transaction_id: String,
    pub bank_operation_id: Option<String>,
    pub confirmed_at: Option<String>,
    pub confirmation: Option<Confirmation>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeexOrder {
    pub id: String,
    pub solicitud_id: String,
    pub plan: BeexPlan,
    pub status: String,
    pub payments: Vec<OrderPayment>,
}
#[derive(Clone)]
pub struct BeexClient {
    http: Client,
    base: String,
    token: String,
}
impl BeexClient {
    #[cfg(test)]
    pub(crate) fn for_test(base: &str) -> Self {
        Self::with_http(
            &BeexConfig {
                base_url: base.to_owned(),
                token: "synthetic-test-token-123456789012345".to_owned(),
                ..Default::default()
            },
            Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap(),
        )
        .unwrap()
    }
    pub fn new(config: &BeexConfig, timeout: Duration) -> Result<Self> {
        config.validate()?;
        Self::with_http(
            config,
            Client::builder()
                .https_only(true)
                .redirect(reqwest::redirect::Policy::none())
                .timeout(timeout)
                .build()?,
        )
    }
    fn with_http(config: &BeexConfig, http: Client) -> Result<Self> {
        Ok(Self {
            http,
            base: format!(
                "{}/integrations/transferencias/v1",
                config.base_url.trim_end_matches('/')
            ),
            token: config.token.clone(),
        })
    }
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token)
    }
    fn decode<T: DeserializeOwned>(response: Response) -> Result<T> {
        let status = response.status();
        if !status.is_success() {
            let body = response.json::<serde_json::Value>().unwrap_or_default();
            bail!(
                "Beex HTTP {}: {}",
                status.as_u16(),
                body.pointer("/error/code")
                    .and_then(|v| v.as_str())
                    .unwrap_or("UNAVAILABLE")
            );
        }
        response.json().context("Respuesta Beex invalida.")
    }
    pub fn candidates(&self) -> Result<Vec<Candidate>> {
        let mut all = Vec::new();
        let mut cursor = None::<String>;
        let mut seen = HashSet::new();
        loop {
            let mut req = self
                .request(reqwest::Method::GET, "/solicitudes")
                .query(&[("limit", "100")]);
            if let Some(ref c) = cursor {
                req = req.query(&[("cursor", c)]);
            }
            let page: Page = Self::decode(req.send()?)?;
            for item in &page.items {
                uuid::Uuid::parse_str(&item.solicitud_id)?;
            }
            all.extend(page.items);
            match page.next_cursor {
                None => return Ok(all),
                Some(c) => {
                    uuid::Uuid::parse_str(&c)?;
                    if !seen.insert(c.clone()) || seen.len() > 10_000 {
                        bail!("Cursor Beex repetido o fuera de limites.");
                    }
                    cursor = Some(c);
                }
            }
        }
    }
    pub fn plan(&self, id: &str) -> Result<BeexPlan> {
        uuid::Uuid::parse_str(id)?;
        let plan: BeexPlan = Self::decode(
            self.request(reqwest::Method::GET, &format!("/solicitudes/{id}/plan"))
                .send()?,
        )?;
        plan.validate()?;
        if plan.solicitud_id != id {
            bail!("Beex devolvio otra solicitud.");
        }
        Ok(plan)
    }
    pub fn order(&self, id: &str) -> Result<BeexOrder> {
        uuid::Uuid::parse_str(id)?;
        Self::decode(
            self.request(reqwest::Method::GET, &format!("/desembolsos/{id}"))
                .send()?,
        )
    }
    pub fn by_key(&self, key: &str) -> Result<Option<BeexOrder>> {
        uuid::Uuid::parse_str(key)?;
        let response = self
            .request(reqwest::Method::GET, &format!("/reservas/{key}"))
            .send()?;
        if response.status() == StatusCode::NOT_FOUND {
            let body = response.json::<serde_json::Value>()?;
            if body.pointer("/error/code").and_then(|v| v.as_str()) == Some("NOT_FOUND") {
                return Ok(None);
            }
            bail!("La integracion Beex no esta disponible.");
        }
        Ok(Some(Self::decode(response)?))
    }
    pub fn reserve(&self, id: &str, input: &Reservation) -> Result<BeexOrder> {
        uuid::Uuid::parse_str(id)?;
        Self::decode(
            self.request(reqwest::Method::POST, &format!("/solicitudes/{id}/reserva"))
                .json(input)
                .send()?,
        )
    }
    pub fn revalidate(&self, id: &str) -> Result<BeexOrder> {
        Self::decode(
            self.request(
                reqwest::Method::POST,
                &format!("/desembolsos/{id}/revalidar"),
            )
            .send()?,
        )
    }
    pub fn confirm(&self, id: &str, payment: &str, evidence: &Confirmation) -> Result<BeexOrder> {
        // A path segment, never interpolated as an unescaped URL.
        let mut url = url::Url::parse(&format!("{}/desembolsos/{id}/pagos/", self.base))?;
        url.path_segments_mut()
            .map_err(|_| anyhow!("URL Beex invalida."))?
            .pop_if_empty()
            .push(payment);
        Self::decode(
            self.http
                .put(url)
                .bearer_auth(&self.token)
                .json(evidence)
                .send()?,
        )
    }
    pub fn receipt(&self, id: &str, bytes: Vec<u8>) -> Result<BeexOrder> {
        let part = reqwest::blocking::multipart::Part::bytes(bytes)
            .file_name("comprobante.pdf")
            .mime_str("application/pdf")?;
        let form = reqwest::blocking::multipart::Form::new().part("file", part);
        Self::decode(
            self.request(
                reqwest::Method::POST,
                &format!("/desembolsos/{id}/comprobante"),
            )
            .multipart(form)
            .send()?,
        )
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    pub fn plan() -> BeexPlan {
        BeexPlan {
            source: "BEEX".to_owned(),
            solicitud_id: uuid::Uuid::new_v4().to_string(),
            nro_solicitud: Some("display-only".to_owned()),
            prestamo_legacy_id: "101".to_owned(),
            financial_line_id: "12".to_owned(),
            currency: "ARS".to_owned(),
            requested_amount: "1000.01".to_owned(),
            total: "1000.01".to_owned(),
            bank: "COINAG".to_owned(),
            requires_renewal_review: false,
            verification: Verification {
                request_number: "101".to_owned(),
                document: "12345678".to_owned(),
                required: true,
            },
            member: BeexMember {
                cuit: "20123456789".to_owned(),
                name: "Synthetic Member".to_owned(),
            },
            payments: vec![BeexPayment {
                payment_key: "member".to_owned(),
                kind: "member".to_owned(),
                amount: "1000.01".to_owned(),
                cbu: "0000000000000000000001".to_owned(),
                cuit: "20123456789".to_owned(),
                name: "Synthetic Member".to_owned(),
                bank_number: Some("1".to_owned()),
            }],
            version: "a".repeat(64),
        }
    }
    pub fn journal() -> crate::beex_recovery::Journal {
        let plan = plan();
        let reservation = Reservation {
            idempotency_key: uuid::Uuid::new_v4().to_string(),
            plan_version: plan.version.clone(),
            installation_id: "test-install".to_owned(),
            operator: "test-operator".to_owned(),
            verification_id: Some("mm-test".to_owned()),
            payments: vec![ReservationPayment {
                payment_key: "member".to_owned(),
                bank_transaction_id: bank_id("123", "1").unwrap(),
            }],
        };
        crate::beex_recovery::Journal::new(plan, reservation)
    }
    pub fn confirmation(journal: &crate::beex_recovery::Journal) -> Confirmation {
        let p = &journal.plan.payments[0];
        Confirmation {
            installation_id: journal.reservation.installation_id.clone(),
            operator: journal.reservation.operator.clone(),
            bank_transaction_id: journal.reservation.payments[0].bank_transaction_id.clone(),
            bank_operation_id: "synthetic-coelsa-id".to_owned(),
            amount: p.amount.clone(),
            currency: "ARS".to_owned(),
            cbu: p.cbu.clone(),
            cuit: p.cuit.clone(),
            confirmed_at: "2026-10-01T12:00:00.000Z".to_owned(),
        }
    }
    pub fn order(journal: &crate::beex_recovery::Journal, confirmed: bool) -> BeexOrder {
        let c = confirmation(journal);
        BeexOrder {
            id: journal
                .order_id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            solicitud_id: journal.solicitud_id.clone(),
            plan: journal.plan.clone(),
            status: if confirmed {
                "BANK_CONFIRMED_PENDING_SYNC"
            } else {
                "RESERVED"
            }
            .to_owned(),
            payments: vec![OrderPayment {
                payment_key: "member".to_owned(),
                bank_transaction_id: c.bank_transaction_id.clone(),
                bank_operation_id: confirmed.then(|| c.bank_operation_id.clone()),
                confirmed_at: confirmed.then(|| c.confirmed_at.clone()),
                confirmation: confirmed.then_some(c),
            }],
        }
    }
    // Local HTTP only. Captures raw requests, allowing multipart and replay checks.
    pub fn server(replies: Vec<(u16, String)>) -> (String, thread::JoinHandle<Vec<Vec<u8>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, response) in replies {
                let deadline = std::time::Instant::now() + Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((s, _)) => break s,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(e) => panic!("Mock request missing: {e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0; 4096];
                loop {
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|p| p == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let length = header
                            .lines()
                            .find_map(|l| {
                                l.strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or_default();
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let header = format!(
                    "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.len()
                );
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(response.as_bytes()).unwrap();
                requests.push(bytes);
            }
            requests
        });
        (url, handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identities_and_amounts_are_strict_and_independent_from_legacy() {
        let plan = test_support::plan();
        let core = plan.core().unwrap();
        assert_eq!(core.request_oid, format!("beex:{}", plan.solicitud_id));
        assert_eq!(core.verification_request_number(), "101");
        assert_eq!(core.credit_line_id, Some(12));
        assert_eq!(core.request_amount.unwrap().to_string(), "1000.01");
        for bad in ["1.001", "1,01", "1e3", "-1.00", "1000", "NaN", "1.0"] {
            assert!(exact_money(bad).is_err());
        }
        let mut missing = plan.clone();
        missing.payments[0].bank_number = None;
        assert!(missing.core().is_err());
        missing = plan.clone();
        missing.total = "1000.02".to_owned();
        assert!(missing.core().is_err());
        missing = plan.clone();
        missing.payments.push(missing.payments[0].clone());
        assert!(missing.core().is_err());
    }
    #[test]
    fn numeric_namespace_is_disjoint_from_normal_and_cancellation_legacy_ids() {
        for n in [1_u64, 9, 99999, 100000, 999999, 9_999_999_999_999] {
            let id = bank_id("123", &n.to_string()).unwrap();
            let suffix = &id[3..];
            assert_eq!(suffix.len(), 15);
            assert_eq!(suffix.as_bytes()[8], b'3');
            assert_eq!(suffix.as_bytes()[14], b'9');
            assert_eq!(bank_id("123", &n.to_string()).unwrap(), id);
            assert_ne!(id, format!("123{:015}", n * 10));
            for kind in [1, 2] {
                assert_ne!(
                    id,
                    format!("123{:08}{kind}{:06}", n % 100_000_000, n % 1_000_000)
                );
            }
        }
        for n in ["0", "01", "10000000000000", "abc", "-1"] {
            assert!(bank_id("123", n).is_err());
        }
        assert!(bank_id("", "1").is_err());
        assert_ne!(bank_id("123", "1").unwrap(), bank_id("123", "2").unwrap());
    }
    #[test]
    fn metamap_checks_the_linked_loan_document_and_requested_amount() {
        let plan = test_support::plan();
        let mut core = plan.core().unwrap();
        core.document_cuil = Some(plan.member.cuit.clone());
        core.coinag_cuil = Some(plan.member.cuit.clone());
        core.coinag_account_type_code = Some("10".to_owned());
        let server = crate::models::ValidationSnapshot {
            verification_id: Some("mm".to_owned()),
            normalized_status: Some("completed".to_owned()),
            request_number: Some("101".to_owned()),
            ..Default::default()
        };
        let mut metamap = crate::models::MetamapSnapshot {
            request_number: Some("101".to_owned()),
            document: Some("12345678".to_owned()),
            amount: Some(exact_money("1000.01").unwrap()),
            ..Default::default()
        };
        let report = crate::validation::build_validation_report(
            &server,
            &metamap,
            &core,
            &crate::models::CoinagTransferGuard::NotFound,
        );
        assert!(report.can_transfer(), "{:?}", report.blockers);
        metamap.request_number = Some("102".to_owned());
        assert!(
            !crate::validation::build_validation_report(
                &server,
                &metamap,
                &core,
                &crate::models::CoinagTransferGuard::NotFound
            )
            .can_transfer()
        );
        metamap.request_number = Some("101".to_owned());
        metamap.amount = Some(exact_money("1000.02").unwrap());
        assert!(
            !crate::validation::build_validation_report(
                &server,
                &metamap,
                &core,
                &crate::models::CoinagTransferGuard::NotFound
            )
            .can_transfer()
        );
    }
    #[test]
    fn zero_net_creditor_uuid_is_preserved_without_numeric_uuid_coercion() {
        let mut plan = test_support::plan();
        let p = &mut plan.payments[0];
        p.kind = "creditor".to_owned();
        p.payment_key = format!("creditor:{}", uuid::Uuid::new_v4());
        p.cuit = "30625567382".to_owned();
        let mut core = plan.core().unwrap();
        core.cancellation_payments[0].account_type_code = Some("10".to_owned());
        let built = crate::cancellations::build_plan(&core);
        assert!(built.can_transfer(), "{:?}", built.blockers);
        assert_eq!(built.legs[0].key, plan.payments[0].payment_key);
        assert_eq!(built.legs.len(), 1);
    }
    #[test]
    fn pagination_auth_and_invalid_disabled_key_lookup_fail_closed() {
        let id = uuid::Uuid::new_v4().to_string();
        let (base, server) = test_support::server(vec![
            (200, serde_json::json!({"items": [{"solicitudId": id, "nroSolicitud": "display", "desembolso": null}], "nextCursor": id}).to_string()),
            (200, "{\"items\":[],\"nextCursor\":null}".to_owned()),
            (404, "{\"error\":{\"code\":\"INTEGRATION_DISABLED\"}}".to_owned()),
        ]);
        let client = BeexClient::for_test(&base);
        assert_eq!(client.candidates().unwrap().len(), 1);
        assert!(client.by_key(&uuid::Uuid::new_v4().to_string()).is_err());
        let requests = server.join().unwrap();
        for request in &requests {
            assert!(String::from_utf8_lossy(request).contains("Bearer synthetic-test-token"));
        }
        assert!(String::from_utf8_lossy(&requests[1]).contains("cursor="));
    }
}
