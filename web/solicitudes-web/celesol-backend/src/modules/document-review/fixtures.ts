import type { ProviderCandidate, ReviewSource } from "./domain";

export function sourceFixture(): ReviewSource {
  return {
    solicitudId: "00000000-0000-4000-8000-000000000001",
    nroSolicitud: "TEST-1",
    prestamoId: "101",
    cycleId: "cycle-1",
    line: "Línea de prueba",
    mutual: "CELESOL",
    name: "Persona de Prueba",
    dni: "30123456",
    amount: "1000.00",
    installments: 6,
    installmentAmount: "200,00",
    birthDate: "1990-01-01",
    address: "Domicilio de prueba",
    phone: "0000000000",
    email: "prueba@example.invalid",
  };
}
export function candidateFixture(id = "valid-1"): ProviderCandidate {
  return {
    verificationId: id,
    originalStatus: "verified",
    completedAt: "2026-10-13T12:00:00Z",
    error: null,
    dashboardUrl: null,
    resource: {
      id,
      identity: { id: "identity-test", status: "verified" },
      hasProblem: false,
      expired: false,
      documents: [
        {
          type: "national-id",
          country: "AR",
          fields: { documentNumber: { value: "30.123.456" } },
          photos: [
            "https://media.prod.metamap.com/front.png",
            "https://media.prod.metamap.com/back.png",
          ],
          steps: [
            { id: "document-reading", status: 200, error: null, data: {} },
            {
              id: "facematch",
              status: 200,
              error: null,
              data: { status: "OK", score: 85 },
            },
          ],
        },
      ],
      customInputValues: {
        fields: [
          {
            name: "Es_Usted_PEP",
            label: "Es usted una persona expuesta políticamente (PEP)",
            atomicFieldParams: {
              type: "checkbox",
              value: false,
              defaultValue: true,
            },
          },
        ],
      },
      steps: [
        {
          id: "selfie",
          status: 200,
          error: null,
          data: { selfiePhotoUrl: "https://media.prod.metamap.com/selfie.png" },
        },
        { id: "watchlists", status: 200, error: null, data: [] },
        {
          id: "electronic-signature-document-validation",
          status: 200,
          error: null,
          data: {
            signedDocumentDetails: [
              {
                documentId: "00000000-0000-4000-8000-000000000002",
                fullName: "Persona de Prueba",
                readAt: "2026-10-13T11:55:00Z",
                signedAt: "2026-10-13T11:57:00Z",
                pdfDocumentUrl: "https://media.prod.metamap.com/signed.pdf",
                customVariables: {
                  request: { title: "Solicitud", value: "101" },
                  amount: { title: "Importe solicitado", value: "$ 1.000,00" },
                  installments: { title: "Cuotas a pagar", value: "6" },
                  installment: { title: "Importe cuota", value: "$ 200,00" },
                },
              },
            ],
          },
        },
      ],
    },
  };
}
