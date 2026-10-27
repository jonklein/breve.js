Walkers steered by a trained neural network in [ONNX](https://onnx.ai/) format, run as one batch for all of them each tick. Swap in your own model: a file path, a URL, or a Hugging Face file. It also runs and replays without the model, using a stand-in.

**count**, **speed** and **push** set how many walkers there are, how fast they go and how strongly the network's output steers them.
