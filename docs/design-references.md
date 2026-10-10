# Mistral AI design references

Retrieved on October 10, 2026 using the official Mobbin MCP server at https://api.mobbin.com/mcp and the owner's existing Fiddle profile connection. The screenshots were visually inspected before applying their layout patterns. The app uses original UI assets; no Mobbin screenshot is shipped in the application.

| Mobbin screen | Observed pattern | AgentOS adaptation |
| --- | --- | --- |
| [Mistral AI conversation](https://mobbin.com/screens/fb67bd1f-8c54-4918-af43-1de93e3758a6) | Compact sidebar, wide empty margins, centered response column, bottom composer, orange send control. | Persistent navigation and history; centered messages; a bottom composer with profile identity and stop control. |
| [Mistral AI working state](https://mobbin.com/screens/f55821bf-0d53-4ae9-92e7-4c68fcf4fffe) | User prompt remains visible while a response is pending; send control becomes a stop button. | Persisted user message, working indicator, tool activity, cancellation, and approval cards. |
| [Mistral AI conversation interaction](https://mobbin.com/screens/f032b5d4-b2ad-4841-ae88-e39cc7add5df) | Response text stays readable and the message input remains available below it. | Markdown messages, response copying, and a composer below a scrollable conversation. |
| [Mistral AI new conversation](https://mobbin.com/screens/edacf670-c966-421c-85ec-ad218e18a549) | Sparse conversation canvas, left navigation, centered message entry, warm orange action accent. | A spacious start screen, an agent picker, clear message entry, and warm orange accents. |

AgentOS adds its own profile roster, task board, activity panel, memory viewer, search dialog, and responsive navigation around those patterns. A second agent-list search returned other products, so those results were not treated as Mistral references.

The saved Mobbin authentication and refreshed tokens remain in the existing Hermes profile outside this repository.
