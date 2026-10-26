# a tiny policy: 4 inputs -> tanh(W x + b) -> 2 outputs, with fixed weights; batch dimension is dynamic
import numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper
W = np.array([[0.5, -0.25], [0.1, 0.3], [-0.4, 0.2], [0.05, 0.05]], dtype=np.float32)  # 4x2
b = np.array([0.1, -0.1], dtype=np.float32)
x = helper.make_tensor_value_info('obs', TensorProto.FLOAT, ['batch', 4])
y = helper.make_tensor_value_info('action', TensorProto.FLOAT, ['batch', 2])
nodes = [helper.make_node('Gemm', ['obs', 'W', 'b'], ['z']), helper.make_node('Tanh', ['z'], ['action'])]
g = helper.make_graph(nodes, 'policy', [x], [y], [numpy_helper.from_array(W, 'W'), numpy_helper.from_array(b, 'b')])
m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 13)])
m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, 'policy.onnx')
print('saved', len(open('policy.onnx','rb').read()), 'bytes')
