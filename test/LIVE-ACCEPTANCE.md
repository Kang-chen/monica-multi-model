# b62 development-browser acceptance

Tested on 2026-09-08 (Asia/Shanghai) using a freshly launched Chrome instance with a dedicated project profile and the actual Monica service. The user signed in to this profile. The source and integrity-checked dependencies were injected automatically; no Tampermonkey extension or existing Chrome account data was used.

## Confirmed failure and fix

With b61, the native chat completed but no comparison panels appeared. The diagnostic listener counted one captured request and two original stream messages, with zero replay requests. The message origin was `https://monica.im`; the actual request target was `https://api.monica.im/api/custom_bot/chat`. Three extra models were enabled. This demonstrated that b61's same-origin request URL restriction incorrectly rejected the production API, independently of window-wrapper identity.

b62 retains same-origin validation for the incoming page message and permits the exact HTTPS Monica API origin for the captured request. Arbitrary external hosts, lookalike hosts, non-HTTPS API URLs, custom ports, credentials in URLs, and unrelated paths remain rejected.

## Live results

- Native Gemini 3.8 Flash response completed; its discovered model mapping was calibrated and the pending label disappeared.
- Gemini 3.5 Flash, GPT-5.5 and Claude Sonnet 5 comparison panels all reached `done` with nonempty responses.
- Automatic Fusion completed. Diagnostic counts included four replay requests: three extra models plus Fusion.
- Switching Fusion to GPT-5.5 and clicking Run produced a real request to that selected model and completed successfully.
- A temporary test model was added, deleted and removed from the Fusion selector. It remained absent after reload, and completed comparison/Fusion results were restored.

The development entry point also passed against a local fixture using the same cross-origin API URL (intercepted locally, with no live requests). The regression suite covers both normal and wrapped windows, model discovery/deletion/restoration, bridge validation, UI lifecycle, build versioning, and Fusion rendering/rerun/restoration.

## Limits

This is live service acceptance through automatic development injection, not confirmation that the user's daily Tampermonkey installation has been replaced. New model IDs inferred only from sidebar names remain unverified until observed in a native request. The page emitted unrelated `fbq is not defined` errors during tests; they did not prevent the verified chat/Fusion flow.
