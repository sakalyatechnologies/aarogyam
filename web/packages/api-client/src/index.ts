export type { ApiClient, AppointmentFilter, DateRange, PatientFilter, PatientSearch, RequestOptions } from "./client.js";
export { randomUuid } from "./uuid.js";
export { createDevTokenSource, createHttpClient, type HttpClientOptions, type TokenSource } from "./http-client.js";
export { PERMISSIONS, hasPermission, type Permission } from "./permissions.js";
export {
  ApiFailure,
  apiErrorOf,
  failure,
  parseApiError,
  success,
  unwrap,
  type ApiError,
  type ApiResult,
  type ClientErrorCode,
} from "./result.js";
export * from "./schemas.js";
