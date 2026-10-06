# Capability matrix

The package keeps the portable contracts small and exposes provider-specific
operations on the concrete clients where the upstream APIs differ.

| Capability | Kavenegar | SMS.ir |
| --- | --- | --- |
| Raw message | `sendMessage` | `sendMessage` |
| Template/verify | `sendTemplate` with ordered tokens | `sendTemplate` with numeric template ID and named parameters |
| Bulk delivery | `sendBulk` | `sendBulk` |
| Per-recipient delivery | `sendArray` | `sendLikeToLike` |
| Scheduling | `sendAt` on raw/bulk messages | `sendAt` on bulk/like-to-like messages |
| Scheduled cancellation | `SmsMessageScheduler.cancelScheduled` by message IDs | `SmsPackScheduler.cancelScheduledPack` by pack ID; `cancelScheduled` remains as a compatibility alias |
| Delivery status | `getDeliveryStatus`, `getStatusByLocalId` | `getMessageStatus`, `getDeliveryStatus` |
| Outbound reporting | `getSentMessages`, `listSentMessages`, `getLatestSentMessages`, `countSentMessages` | `listPacks`, `getPack` |
| Inbound SMS | `getReceivedMessages`, `countReceivedMessages` | Not provided by the documented REST surface |

All provider clients accept an injected `fetcher`, timeout, custom base URL,
additional headers, and an optional retry policy. Retry is disabled unless
`retry.maxAttempts` is explicitly configured.

The capability contracts are generic. This keeps provider-specific request and
result types precise while allowing shared code to depend on
`SmsMessageSender`, `SmsTemplateSender`, `SmsBulkSender`,
`SmsDeliveryStatusReader`, `SmsMessageScheduler`, or `SmsPackScheduler` as
appropriate. SMS.ir raw and bulk inputs deliberately omit Kavenegar-only
`sender`, `localId`, and `tag` fields; Zod rejects those fields at runtime too.
