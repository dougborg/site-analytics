export {
  type AnalyticsConfig,
  analyticsConfig,
  configElement,
  type DeclaredEventData,
  declaredEventAttributes,
  type ValidAnalyticsConfig,
} from "./config.ts";
export {
  allowedEvent,
  BUILT_IN_EVENTS,
  type BuiltInEventName,
  type ChoiceField,
  COLLECTION,
  DECLARED_EVENTS,
  type DeclaredEventName,
  type DeclaredEventSpec,
  type EventName,
  type EventSpec,
  type Field,
  PAYLOAD_FIELDS,
  siteEvents,
} from "./contract.ts";
export { undisclosedEvents } from "./disclosure.ts";
export { type NoticeOptions, privacyNotice } from "./notice.ts";
