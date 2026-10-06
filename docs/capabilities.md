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
| Scheduled cancellation | `cancelScheduled` by message IDs | `cancelScheduled` by pack ID |
| Delivery status | `getDeliveryStatus`, `getStatusByLocalId` | `getMessageStatus`, `getDeliveryStatus` |
| Outbound reporting | `getSentMessages`, `listSentMessages`, `getLatestSentMessages`, `countSentMessages` | `listPacks`, `getPack` |
| Inbound SMS | `getReceivedMessages`, `countReceivedMessages` | Not provided by the documented REST surface |

All provider clients accept an injected `fetcher`, timeout, custom base URL,
additional headers, and an optional retry policy. Retry is disabled unless
`retry.maxAttempts` is explicitly configured.
