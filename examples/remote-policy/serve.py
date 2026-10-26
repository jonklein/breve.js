# A policy served from Python over a WebSocket. Start it, then run the simulation (the workbench page, or
#   node --import tsx scripts/run.mjs remote-policy 300 100
# ). Each tick the simulation sends one message for the whole crowd and waits for one reply:
#
#   request : uint32 rows, uint32 width, then rows * width float32      (all little-endian)
#   reply   : uint32 rows, uint32 width, then rows * width float32      (width = numbers per answer)
#
# Here the "policy" is the same swirl the ONNX example uses, written in NumPy. Put a trained network, a search or a
# learning loop in `act` instead: it sees every observation, and may keep state between calls. To learn from rewards,
# have the script add a reward to each observation row (more numbers per row), and read it here.
#
#   pip install websockets numpy && python3 serve.py
import asyncio
import struct

import numpy as np
import websockets

W = np.array([[-1.2, 0.9], [-0.9, -1.2], [-0.3, 0.0], [0.0, -0.3]], dtype=np.float32)


def act(obs: np.ndarray) -> np.ndarray:
    """obs is (rows, 4): x/20, z/20, vx/6, vz/6. Returns (rows, 2): a steering direction."""
    return np.tanh(obs @ W)


async def serve(ws):
    async for message in ws:
        rows, width = struct.unpack("<II", message[:8])
        obs = np.frombuffer(message, dtype="<f4", offset=8, count=rows * width).reshape(rows, width)
        out = act(obs).astype("<f4")
        await ws.send(struct.pack("<II", rows, out.shape[1]) + out.tobytes())


async def main():
    async with websockets.serve(serve, "localhost", 8765):
        print("policy server on ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
