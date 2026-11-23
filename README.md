# Nova Patrol

A wave-based space shooter: blast alien waves, grab power-ups and beat a boss
every fifth wave. Made for ages 9 and up.

**[Play it → mike.pullen.dev/nova-patrol/](https://mike.pullen.dev/nova-patrol/)**

## How to play

Arrow keys or WASD to move (or drag on a touch screen), B or X for a bomb (or
the 💣 button), P or Esc to pause. The ship fires on its own.

## Development

There's no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4321
```

Then open <http://localhost:4321/>.

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `npm ci`         | Install the dev tooling (once)                 |
| `npm test`       | Run the tests with Node's built-in test runner |
| `npm run lint`   | Check formatting (Prettier) and HTML validity  |
| `npm run format` | Format the code with Prettier                  |

## Tech

Plain HTML, CSS and JavaScript with no framework, no runtime dependencies and no
build step. Deployed to [Vercel](https://vercel.com) with a strict
Content-Security-Policy in `vercel.json`, and served on
[mike.pullen.dev](https://mike.pullen.dev) through that site's proxy rewrites.
Roboto Mono is self-hosted in `fonts/` (SIL OFL 1.1, see `fonts/OFL.txt`).
