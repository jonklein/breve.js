# Makes policy.onnx: a one-layer network, tanh(obs . W + b), small enough to read.
#   obs    = [x / 20, z / 20, vx / 6, vz / 6]   (position and velocity, scaled to about -1..1)
#   action = [dx, dz]                           (a steering direction)
# The weights pull an agent toward the middle, add a sideways push so it circles instead of dropping in,
# and damp its speed. Swap in your own trained network to see a different behavior: any ONNX file whose
# input is [batch, 4] and whose output is [batch, 2] works with policy.js unchanged.
#   pip install onnx numpy && python3 make_policy.py
import numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper

W = np.array([
    [-1.2,  0.9],   # x
    [-0.9, -1.2],   # z
    [-0.3,  0.0],   # vx
    [ 0.0, -0.3],   # vz
], dtype=np.float32)
b = np.zeros(2, dtype=np.float32)

obs = helper.make_tensor_value_info('obs', TensorProto.FLOAT, ['batch', 4])
action = helper.make_tensor_value_info('action', TensorProto.FLOAT, ['batch', 2])
nodes = [helper.make_node('Gemm', ['obs', 'W', 'b'], ['z']), helper.make_node('Tanh', ['z'], ['action'])]
graph = helper.make_graph(nodes, 'policy', [obs], [action], [numpy_helper.from_array(W, 'W'), numpy_helper.from_array(b, 'b')])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, 'policy.onnx')
