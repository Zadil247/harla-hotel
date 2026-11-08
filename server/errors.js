export class PublicError extends Error {
  constructor(message, status = 400, code = "request_error") {
    super(message);
    this.name = "PublicError";
    this.status = status;
    this.code = code;
  }
}

export class ConfigurationError extends PublicError {
  constructor(message) {
    super(message, 503, "payment_configuration_required");
    this.name = "ConfigurationError";
  }
}

export function publicErrorResponse(error) {
  if (error instanceof PublicError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error("Harla payment function error", error);
  return Response.json(
    {
      error: "The secure payment service could not complete this request. Please try again or contact Harla Hotel.",
      code: "payment_service_error",
    },
    { status: 500 },
  );
}
