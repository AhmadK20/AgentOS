# AgentOS design references

Retrieved on October 10, 2026 using the official Mobbin MCP server at https://api.mobbin.com/mcp and the owner's existing Fiddle profile connection. The screenshots were visually inspected before applying their layout patterns. The app uses original UI assets; no Mobbin screenshot is shipped in the application.

| Mobbin screen | Observed pattern | AgentOS adaptation |
| --- | --- | --- |
| [Mistral AI conversation](https://mobbin.com/screens/fb67bd1f-8c54-4918-af43-1de93e3758a6) | Compact sidebar, wide empty margins, centered response column, bottom composer, orange send control. | Persistent navigation and history; centered messages; a bottom composer with profile identity and stop control. |
| [Mistral AI working state](https://mobbin.com/screens/f55821bf-0d53-4ae9-92e7-4c68fcf4fffe) | User prompt remains visible while a response is pending; send control becomes a stop button. | Persisted user message, working indicator, tool activity, cancellation, and approval cards. |
| [Mistral AI conversation interaction](https://mobbin.com/screens/f032b5d4-b2ad-4841-ae88-e39cc7add5df) | Response text stays readable and the message input remains available below it. | Markdown messages, response copying, and a composer below a scrollable conversation. |
| [Mistral AI new conversation](https://mobbin.com/screens/edacf670-c966-421c-85ec-ad218e18a549) | Sparse conversation canvas, left navigation, centered message entry, warm orange action accent. | A spacious start screen, an agent picker, clear message entry, and warm orange accents. |

AgentOS adds its own profile roster, task board, activity panel, memory viewer, search dialog, and responsive navigation around those patterns. A second agent-list search returned other products, so those results were not treated as Mistral references.

The saved Mobbin authentication and refreshed tokens remain in the existing Hermes profile outside this repository.

## Warm holographic workspace

The October 12 visual refresh uses additional Mobbin references inspected with the owner. The existing ivory, orange, and dark-mode palette is retained. The sphere is original SVG geometry, with decorative motion disabled when reduced motion is requested. Agent names, skill counts, connection state, and active run counts come from the existing runtime.

| Mobbin screen | Observed pattern | AgentOS adaptation |
| --- | --- | --- |
| [Higgsfield agent profile](https://mobbin.com/screens/f78779ad-86d7-45bb-b902-d537b69432ea) | Holographic agent identity, floating composer, layered cards. | An orange glass sphere with the selected agent's identity, raised composer, and layered profile cards. |
| [ElevenLabs assistant](https://mobbin.com/screens/8e1fb2d5-4b3c-44ab-a104-cc23054d1b6f) | A distinctive orb gives the assistant a visual presence. | An abstract sphere with orbital and wireframe details, using the existing orange accent. |
| [Lovable workspace](https://mobbin.com/screens/9723c916-fef5-489d-9372-3090bf6f2953) | Soft ambient gradients and a floating message entry surface. | A restrained warm glow, fine background grid, and translucent composer with a clear focus ring. |
| [Dashboard preview inside Lovable](https://mobbin.com/screens/ad361de1-19e5-4115-b654-876e0d8c06a8) | Layered dark metric cards and consistent accent highlights. | Theme-aware activity cards, task columns, and navigation highlights in orange. |

Reference screenshots remain outside the app and repository; no source screenshots or third-party artwork are bundled in the interface.
