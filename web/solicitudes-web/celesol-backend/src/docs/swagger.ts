import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  apis: ["src/app.ts", "src/modules/**/*.ts", "src/docs/swagger/**/*.ts"],
  definition: {
    info: {
      description: "Backend API for Celesol.",
      title: "Celesol Backend API",
      version: "1.0.0",
    },
    openapi: "3.0.0",
  },
});
