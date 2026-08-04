import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import type { CSSProperties } from "react";

import type { ConfirmAccountEmailMetadata } from "../config/email-metadata-config";

export function ConfirmAccountTemplate(
  metadata: ConfirmAccountEmailMetadata,
): React.JSX.Element {
  const bodyStyle: CSSProperties = {
    backgroundColor: metadata.backgroundColor,
    fontFamily: "Arial, sans-serif",
    margin: 0,
    padding: "32px 16px",
  };
  const containerStyle: CSSProperties = {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "520px",
    padding: "32px",
  };
  const codeStyle: CSSProperties = {
    backgroundColor: "#eff6ff",
    border: `1px solid ${metadata.primaryColor}`,
    borderRadius: "6px",
    color: metadata.primaryColor,
    fontSize: "32px",
    fontWeight: 700,
    letterSpacing: "6px",
    margin: "24px 0",
    padding: "16px 20px",
    textAlign: "center",
  };

  return (
    <Html>
      <Head />
      <Preview>Código de verificación de {metadata.appName}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={{ color: metadata.textColor, margin: "0 0 16px" }}>
            Confirma tu cuenta
          </Heading>
          <Text style={{ color: metadata.secondaryTextColor, fontSize: "15px" }}>
            Usa este código para verificar tu cuenta en {metadata.appName}.
          </Text>
          <Section style={codeStyle}>{metadata.code}</Section>
          <Text style={{ color: metadata.secondaryTextColor, fontSize: "13px" }}>
            Si no solicitaste este registro, podés ignorar este mensaje.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
