Each character occasionally asks a language model (Claude) where to go. The question is slow, so the simulation keeps running and the answers land when they arrive. Every answer is logged, so a run can be **saved and replayed exactly** without asking the model again.

Needs an `ANTHROPIC_API_KEY` in the server's `.env`; without it the characters just keep drifting. Use the **Thinking** bar to switch between *async* (keep running) and *wait* (each tick waits for every answer), and to save or replay the log. **speed** and **push** set how fast they move and how strongly an answer steers them.
