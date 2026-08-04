/**
 * Commerce Engine For Cloud — PineTree's documented provider contract.
 *
 * Everything exported here is PURE: request construction, response field
 * reading, and device classification. Transport belongs to the shared Shift4
 * REST client (`providers/shift4/rest/client.ts`), which owns base URL
 * selection, the required headers, timeouts, redaction, and error
 * normalization. There is deliberately no second HTTP stack in this directory.
 */

export {
  SHIFT4_CLOUD_DEVICE_MANUFACTURERS,
  SHIFT4_CLOUD_SERIAL_NUMBER_MAX_LENGTH,
  SHIFT4_CLOUD_UNRESOLVED_REQUIRED_FIELDS,
  SHIFT4_COMMERCE_ENGINE_DEVICES,
  SHIFT4_OPERATION_ROUTING,
  classifyShift4Device,
  shift4RoutingFor,
} from "./contract"
export type {
  Shift4CloudDevice,
  Shift4CloudDeviceManufacturer,
  Shift4CommerceEngineDeviceEntry,
  Shift4DeviceClassification,
  Shift4DeviceClassificationResult,
  Shift4IntegrationRoute,
  Shift4OperationRouting,
} from "./contract"

export {
  Shift4CloudRequestError,
  buildShift4CloudDeviceStatusRequest,
  isShift4CloudManufacturer,
  readShift4CloudDeviceStatusFlags,
} from "./deviceStatus"
export type {
  Shift4CloudDeviceStatusFlags,
  Shift4CloudDeviceStatusRequest,
} from "./deviceStatus"

export {
  buildShift4CloudTransactionRequest,
  shift4CloudAmountFromMinor,
} from "./transactionRequest"
export type {
  Shift4CloudTransactionBuild,
  Shift4CloudTransactionOperation,
  Shift4CloudTransactionRequest,
} from "./transactionRequest"
