Each scout has a camera: a small top-down picture of what is around it. Its slow `think()` shows that picture to a vision model and asks where to go. Scouts are never told where the food is; they have to see it.

Needs an `ANTHROPIC_API_KEY` in the server's `.env`. Answers are logged, so a run can be replayed without the model (see the **Thinking** bar). **speed** and **push** set how fast they move and how strongly an answer steers them.
