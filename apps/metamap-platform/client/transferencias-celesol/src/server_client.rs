use std::collections::HashSet;

use anyhow::{Context, Result, anyhow, ensure};
use reqwest::blocking::{Client, Response};
use serde_json::{Value, json};

use crate::{
    config::ServerConfig,
    models::{CoreSnapshot, ValidationRejection, ValidationSearchResponse, ValidationSnapshot},
    validation::metamap_mismatches,
};

const VALIDATION_PAGE_SIZE: usize = 200;
const MAX_VALIDATION_OFFSET: usize = 10_000;

#[derive(Clone)]
pub struct ServerClient {
    http: Client,
    base_url: String,
    client_id: String,
    client_secret: String,
}

impl ServerClient {
    pub fn new(config: &ServerConfig, timeout: std::time::Duration) -> Result<Self> {
        let http = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(config.allow_invalid_certs)
            .build()
            .context("No se pudo construir el cliente HTTP del server.")?;
        Ok(Self {
            http,
            base_url: config.base_url.trim_end_matches('/').to_owned(),
            client_id: config.client_id.clone(),
            client_secret: config.client_secret.clone(),
        })
    }

    pub fn find_validation_for_core(
        &self,
        core: &CoreSnapshot,
    ) -> Result<Option<ValidationSnapshot>> {
        let request_number = core.verification_request_number();
        log::debug!(
            "Buscando validacion completed en server para solicitud {}.",
            request_number.trim()
        );
        let items = collect_validation_pages(|offset| {
            let response = self.request(
                self.http
                    .get(format!("{}/api/v1/validations", self.base_url))
                    .header("X-Client-Id", &self.client_id)
                    .header("X-Client-Secret", &self.client_secret)
                    .query(&[
                        ("request_number", request_number.trim().to_owned()),
                        ("normalized_status", "completed".to_owned()),
                        ("limit", VALIDATION_PAGE_SIZE.to_string()),
                        ("offset", offset.to_string()),
                    ]),
            )?;
            response
                .json::<ValidationSearchResponse>()
                .context("No se pudo decodificar la respuesta de validaciones del server.")
        })?;
        let selected = select_validation(items, core);
        log::debug!(
            "Seleccion MetaMap para solicitud {}: {:?}.",
            request_number.trim(),
            selected
        );
        Ok(selected)
    }

    pub fn send_transfer_trace_events(&self, events: &[Value]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        self.request(
            self.http
                .post(format!("{}/api/v1/transfer-trace-events", self.base_url))
                .header("X-Client-Id", &self.client_id)
                .header("X-Client-Secret", &self.client_secret)
                .json(&json!({ "events": events })),
        )?;
        Ok(())
    }

    fn request(&self, builder: reqwest::blocking::RequestBuilder) -> Result<Response> {
        let response = builder
            .send()
            .context("No se pudo conectar con el server.")?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let detail = extract_error_body(response);
        log::warn!("Server devolvio {status}: {detail}");
        Err(anyhow!("Server devolvio {status}: {detail}"))
    }
}

fn collect_validation_pages(
    mut fetch: impl FnMut(usize) -> Result<ValidationSearchResponse>,
) -> Result<Vec<ValidationSnapshot>> {
    let mut items = Vec::new();
    let mut offset = 0;
    let mut seen = HashSet::new();
    loop {
        ensure!(
            offset <= MAX_VALIDATION_OFFSET,
            "La cantidad de validaciones supera la ventana consultable del server."
        );
        let page = fetch(offset)?;
        let returned = page.items.len();
        ensure!(
            returned > 0 || offset >= page.pagination.total,
            "El server devolvio una pagina vacia antes de completar la consulta de validaciones."
        );
        offset += returned;
        for item in page.items {
            if item
                .verification_id
                .as_ref()
                .is_none_or(|id| seen.insert(id.clone()))
            {
                items.push(item);
            }
        }
        if offset >= page.pagination.total {
            return Ok(items);
        }
    }
}

fn select_validation(
    mut items: Vec<ValidationSnapshot>,
    core: &CoreSnapshot,
) -> Option<ValidationSnapshot> {
    // Webhook replays change last_received_at; completion time determines recency.
    items.sort_by(|left, right| {
        let date = |item: &ValidationSnapshot| {
            item.completed_at
                .or(item.latest_event_timestamp)
                .or(item.first_received_at)
        };
        date(right)
            .cmp(&date(left))
            .then_with(|| right.verification_id.cmp(&left.verification_id))
    });
    if items.is_empty() {
        return None;
    }
    let mut selected_index = None;
    let mut rejections = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let mut reasons = metamap_mismatches(item, &item.to_metamap_snapshot(), core);
        if !item.has_completed_validation() {
            reasons.push("La validacion no esta completed o no tiene verification_id.".to_owned());
        }
        if reasons.is_empty() {
            selected_index.get_or_insert(index);
        } else {
            rejections.push(ValidationRejection {
                verification_id: item.verification_id.clone(),
                reasons,
            });
        }
    }
    let match_count = items.len();
    // Keep the latest failed attempt for display/audit when none qualifies.
    let mut selected = items.remove(selected_index.unwrap_or(0));
    selected.match_count = match_count;
    selected.selection_rejections = rejections;
    Some(selected)
}

fn extract_error_body(response: Response) -> String {
    let text = response.text().unwrap_or_else(|_| "sin detalle".to_owned());
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|body| {
            body.get("detail")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .unwrap_or(text)
}

#[cfg(test)]
mod tests {
    use rust_decimal::Decimal;

    use super::*;
    use crate::{
        models::{CoinagTransferGuard, ValidationPagination},
        validation::build_validation_report,
        warnings::WarningKind,
    };

    fn core() -> CoreSnapshot {
        CoreSnapshot {
            request_oid: "123".to_owned(),
            request_document: Some("30111222".to_owned()),
            request_amount: Some(Decimal::new(1000, 0)),
            request_status: Some("A Transferir".to_owned()),
            bank_cmf_amount: Some(Decimal::new(1000, 0)),
            request_cuil: Some("20301112223".to_owned()),
            document_cuil: Some("20301112223".to_owned()),
            coinag_cuil: Some("20301112223".to_owned()),
            coinag_account_type_code: Some("10".to_owned()),
            transfer_cbu: Some("2850590940090418135201".to_owned()),
            ..Default::default()
        }
    }

    fn candidate(id: &str, minute: u8) -> ValidationSnapshot {
        ValidationSnapshot {
            verification_id: Some(id.to_owned()),
            normalized_status: Some("completed".to_owned()),
            request_number: Some("123".to_owned()),
            document_number: Some("30.111.222".to_owned()),
            requested_amount_value: Some("1000.00".to_owned()),
            completed_at: Some(
                chrono::DateTime::parse_from_rfc3339(&format!("2026-10-08T15:{minute:02}:00Z"))
                    .unwrap()
                    .with_timezone(&chrono::Utc),
            ),
            ..Default::default()
        }
    }

    fn page(items: Vec<ValidationSnapshot>, total: usize) -> ValidationSearchResponse {
        ValidationSearchResponse {
            items,
            pagination: ValidationPagination { total },
        }
    }

    #[test]
    fn newer_attempt_without_dni_does_not_replace_valid_completed_attempt() {
        let valid = candidate("valid", 25);
        let mut latest = candidate("latest", 52);
        latest.document_number = None;
        let core = core();
        let selected = select_validation(vec![latest, valid], &core).unwrap();
        assert_eq!(selected.verification_id.as_deref(), Some("valid"));
        assert_eq!(selected.match_count, 2);
        assert_eq!(
            selected.selection_rejections[0].verification_id.as_deref(),
            Some("latest")
        );
        assert!(selected.selection_rejections[0].reasons[0].contains("documento"));
        let report = build_validation_report(
            &selected,
            &selected.to_metamap_snapshot(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(report.can_transfer());
        assert!(!report.can_transfer_automatically());
        assert_eq!(
            report.warnings[0].kind,
            WarningKind::MultipleMetamapValidations
        );
        assert!(report.warnings[0].message.contains("valid"));
        assert!(report.warnings[0].message.contains("latest"));
    }

    #[test]
    fn completion_date_beats_replayed_events_and_selects_latest_eligible() {
        let latest = candidate("latest", 30);
        let mut replayed = candidate("old-replayed", 20);
        replayed.latest_event_timestamp = candidate("event", 50).completed_at;
        let selected = select_validation(vec![replayed, latest], &core()).unwrap();
        assert_eq!(selected.verification_id.as_deref(), Some("latest"));
    }

    #[test]
    fn no_eligible_attempt_is_an_explicit_warning_and_other_blockers_remain() {
        let mut latest = candidate("latest-wrong-document", 52);
        latest.document_number = Some("99888777".to_owned());
        let mut older = candidate("older-wrong-amount", 25);
        older.requested_amount_value = Some("2000.00".to_owned());
        let mut core = core();
        let selected = select_validation(vec![latest, older], &core).unwrap();
        assert_eq!(
            selected.verification_id.as_deref(),
            Some("latest-wrong-document")
        );
        let report = build_validation_report(
            &selected,
            &selected.to_metamap_snapshot(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(report.can_transfer());
        assert!(!report.can_transfer_automatically());
        assert_eq!(report.warnings[0].kind, WarningKind::InvalidMetamap);
        for text in [
            "ninguna cumple",
            "Documento no coincide",
            "Monto no coincide",
            "latest-wrong-document",
            "older-wrong-amount",
        ] {
            assert!(report.warnings[0].message.contains(text));
        }
        core.request_status = Some("Pendiente".to_owned());
        core.transfer_cbu = None;
        let blocked = build_validation_report(
            &selected,
            &selected.to_metamap_snapshot(),
            &core,
            &CoinagTransferGuard::YaTransferida,
        );
        assert!(!blocked.can_transfer());
        assert_eq!(blocked.blockers.len(), 3);
    }

    #[test]
    fn selection_uses_current_core_and_never_combines_incomplete_attempts() {
        let mut without_document = candidate("no-document", 52);
        without_document.document_number = None;
        let mut without_amount = candidate("no-amount", 25);
        without_amount.requested_amount_value = None;
        let selected = select_validation(vec![without_document, without_amount], &core()).unwrap();
        assert!(selected.document_number.is_none());
        assert_eq!(selected.selection_rejections.len(), 2);
        let mut old = candidate("old-amount", 25);
        let mut new = candidate("new-amount", 52);
        new.requested_amount_value = Some("2000.00".to_owned());
        let mut core = core();
        assert_eq!(
            select_validation(vec![old.clone(), new.clone()], &core)
                .unwrap()
                .verification_id
                .as_deref(),
            Some("old-amount")
        );
        core.request_amount = Some(Decimal::new(2000, 0));
        assert_eq!(
            select_validation(vec![old.clone(), new], &core)
                .unwrap()
                .verification_id
                .as_deref(),
            Some("new-amount")
        );
        old.request_number = Some("999".to_owned());
        assert!(
            select_validation(vec![old], &core)
                .unwrap()
                .selection_rejections[0]
                .reasons
                .iter()
                .any(|reason| reason.contains("solicitud 999"))
        );
    }

    #[test]
    fn beex_selection_uses_linked_verification_number_instead_of_uuid() {
        let plan = crate::beex_client::test_support::plan();
        let core = plan.core().unwrap();
        let mut valid = candidate("linked", 25);
        valid.request_number = Some(core.verification_request_number().to_owned());
        valid.document_number = core.request_document.clone();
        valid.requested_amount_value = core.request_amount.map(|amount| amount.to_string());
        assert!(
            select_validation(vec![valid], &core)
                .unwrap()
                .selection_rejections
                .is_empty()
        );
    }

    #[test]
    fn pagination_reaches_eligible_attempt_beyond_first_page_and_ten_results() {
        let mut offsets = Vec::new();
        let items = collect_validation_pages(|offset| {
            offsets.push(offset);
            Ok(if offset == 0 {
                page(
                    (0..200)
                        .map(|index| {
                            let mut item = candidate(&format!("invalid-{index}"), 52);
                            item.document_number = None;
                            item
                        })
                        .collect(),
                    201,
                )
            } else {
                page(vec![candidate("eligible-page-two", 25)], 201)
            })
        })
        .unwrap();
        assert_eq!(offsets, [0, 200]);
        let selected = select_validation(items, &core()).unwrap();
        assert_eq!(
            selected.verification_id.as_deref(),
            Some("eligible-page-two")
        );
        assert_eq!(selected.match_count, 201);
    }

    #[test]
    fn incomplete_or_failed_pagination_does_not_masquerade_as_missing_metamap() {
        assert!(collect_validation_pages(|_| Ok(page(vec![], 1))).is_err());
        assert!(
            collect_validation_pages(|offset| {
                if offset == 0 {
                    Ok(page(vec![candidate("valid", 25)], 2))
                } else {
                    Err(anyhow!("Consulta no disponible"))
                }
            })
            .is_err()
        );
        assert!(select_validation(vec![], &core()).is_none());
    }

    #[test]
    fn client_reads_existing_api_pages_and_authenticates_each_request() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            for offset in [0, 200] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 2048];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = stream.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                }
                let request = String::from_utf8(request).unwrap().to_lowercase();
                assert!(request.starts_with("get /api/v1/validations?"));
                for value in [
                    "request_number=123",
                    "normalized_status=completed",
                    "limit=200",
                    &format!("offset={offset}"),
                    "x-client-id: test-client",
                    "x-client-secret: test-secret",
                ] {
                    assert!(request.contains(value), "Request missing {value}");
                }
                let items = if offset == 0 {
                    (0..200).map(|index| json!({
                        "verification_id": format!("invalid-{index}"), "normalized_status": "completed",
                        "request_number": "123", "completed_at": "2026-10-08T15:52:00Z",
                        "document_number": null, "requested_amount_value": "1000.00"
                    })).collect::<Vec<_>>()
                } else {
                    vec![json!({
                        "verification_id": "eligible-page-two", "normalized_status": "completed",
                        "request_number": "123", "completed_at": "2026-10-08T15:25:00Z",
                        "document_number": "30111222", "requested_amount_value": "1000.00"
                    })]
                };
                let body = json!({"items": items, "pagination": {"total": 201}}).to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let client = ServerClient::new(
            &ServerConfig {
                base_url,
                client_id: "test-client".to_owned(),
                client_secret: "test-secret".to_owned(),
                allow_invalid_certs: false,
            },
            std::time::Duration::from_secs(5),
        )
        .unwrap();
        let selected = client.find_validation_for_core(&core()).unwrap().unwrap();
        assert_eq!(
            selected.verification_id.as_deref(),
            Some("eligible-page-two")
        );
        assert_eq!(selected.match_count, 201);
        server.join().unwrap();
    }
}
