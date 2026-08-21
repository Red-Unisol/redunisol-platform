import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import * as React from "react";
import type { CSSProperties } from "react";

import type { ResetPasswordEmailMetadata } from "../config/email-metadata-config";

export function ResetPasswordTemplate(
  metadata: ResetPasswordEmailMetadata,
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
  const buttonStyle: CSSProperties = {
    backgroundColor: metadata.primaryColor,
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 700,
    margin: "16px 0",
    padding: "12px 18px",
    textDecoration: "none",
  };

  return (
    <Html>
      <Head />
      <Preview>Restablece tu contraseña de {metadata.appName}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={{ color: metadata.textColor, margin: "0 0 16px" }}>
            Restablece tu contraseña
          </Heading>
          <Text style={{ color: metadata.secondaryTextColor, fontSize: "15px" }}>
            Recibimos una solicitud para cambiar la contraseña de tu cuenta en{" "}
            {metadata.appName}.
          </Text>
          <Button href={metadata.resetUrl} style={buttonStyle}>
            Cambiar contraseña
          </Button>
          <Text style={{ color: metadata.secondaryTextColor, fontSize: "13px" }}>
            Este enlace vence pronto. Si no solicitaste este cambio, podés
            ignorar este mensaje.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
