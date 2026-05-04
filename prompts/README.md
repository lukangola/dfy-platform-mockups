# Prompt registry

One file per action. Filename (without `.md`) is the action id used in the API path:

- `POST /api/generate/text/<action>`   → for Claude-backed text actions
- `POST /api/generate/image/<action>`  → for fal.ai image actions
- `POST /api/generate/video/<action>`  → for fal.ai video actions

## Templating

Plain Markdown. Use `{{variable}}` anywhere; the server substitutes from the JSON `vars` in the request body. Nested paths work: `{{product.name}}`.

## Hot reload

In dev, the server re-reads the file on every request — edit and re-click the UI button. No restart.

## Versioning

The server stores a 12-char SHA of the file content on every generation row (`prompt_version`), so you can tell which prompt version produced which output.

## Empty or missing

If the file is missing or empty, the endpoint returns `424` with a clear message. That's the signal that the prompt hasn't been configured yet.

## Workflow

We fill these in **one action at a time** — I ask you for the master prompt for a specific action, you paste it into the corresponding file, we click the button in the UI, validate the output, iterate on the prompt if needed, then move to the next action.
