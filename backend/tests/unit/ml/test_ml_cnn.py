"""AstroNet CNN architectures: output shapes, flatten sizes, gradient flow, input validation."""

from __future__ import annotations

import pytest
import torch

from exofinder.config import GLOBAL_VIEW_BINS, LOCAL_VIEW_BINS
from exofinder.ml.models.cnn import SingleViewCNN, TwoViewCNN, count_parameters, has_dropout


def test_two_view_shapes_full_geometry() -> None:
    torch.manual_seed(0)
    model = TwoViewCNN()
    # 2001 -> 999 -> 498 -> 247 -> 122 -> 59 bins x 256 filters; 201 -> 98 -> 46 bins x 32 filters
    assert model.global_flat == 59 * 256
    assert model.local_flat == 46 * 32
    g = torch.randn(3, 1, GLOBAL_VIEW_BINS)
    loc = torch.randn(3, 1, LOCAL_VIEW_BINS)
    out = model(g, loc)
    assert out.shape == (3,)
    assert model(g[:, 0, :], loc[:, 0, :]).shape == (3,)  # (B, L) also accepted
    # conv params + 4 x FC(512) head + output layer
    assert count_parameters(model) == 9_940_193


def test_single_view_ignores_local() -> None:
    torch.manual_seed(0)
    model = SingleViewCNN().eval()
    g = torch.randn(2, 1, GLOBAL_VIEW_BINS)
    a = model(g, None)
    b = model(g, torch.randn(2, 1, LOCAL_VIEW_BINS))
    assert a.shape == (2,)
    torch.testing.assert_close(a, b)


def test_dynamic_flatten_for_other_lengths() -> None:
    model = TwoViewCNN(global_bins=201, local_bins=61, fc_width=16, fc_layers=1)
    assert model(torch.randn(4, 1, 201), torch.randn(4, 1, 61)).shape == (4,)
    with pytest.raises(ValueError, match="too short"):
        TwoViewCNN(global_bins=100, local_bins=61)


def test_wrong_input_length_rejected() -> None:
    model = TwoViewCNN(global_bins=201, local_bins=61, fc_width=8, fc_layers=1)
    with pytest.raises(ValueError, match="shape"):
        model(torch.randn(2, 1, 202), torch.randn(2, 1, 61))
    with pytest.raises(ValueError):
        model(torch.randn(2, 1, 201), None)


@pytest.mark.parametrize("cls", [SingleViewCNN, TwoViewCNN])
def test_gradient_flows_to_every_parameter(cls: type) -> None:
    torch.manual_seed(1)
    kwargs = {"global_bins": 201, "fc_width": 16, "dropout": 0.0}
    if cls is TwoViewCNN:
        kwargs["local_bins"] = 61
    model = cls(**kwargs)
    g = torch.randn(8, 1, 201)
    loc = torch.randn(8, 1, 61)
    y = torch.tensor([0, 1] * 4, dtype=torch.float32)
    loss = torch.nn.functional.binary_cross_entropy_with_logits(model(g, loc), y)
    loss.backward()
    for name, p in model.named_parameters():
        assert p.grad is not None, name
        assert torch.isfinite(p.grad).all(), name
        assert p.grad.abs().sum() > 0, f"no gradient reached {name}"


def test_dropout_detection_and_arch_kwargs() -> None:
    assert has_dropout(TwoViewCNN(global_bins=201, local_bins=61, fc_width=8, dropout=0.3))
    m = SingleViewCNN(global_bins=201, fc_width=8, dropout=0.0)
    assert not has_dropout(m)
    assert m.arch_kwargs == {"global_bins": 201, "fc_width": 8, "dropout": 0.0, "fc_layers": 4}
    with pytest.raises(ValueError):
        SingleViewCNN(dropout=1.0)


def test_initialisation_propagates_signal() -> None:
    """Regression: PyTorch's default init left the 14-layer AstroNet stack nearly constant (logit
    spread ~1e-4 across inputs), so training at the default lr=1e-4 stalled for many epochs."""
    from torch import nn

    torch.manual_seed(0)
    g = torch.randn(64, 1, GLOBAL_VIEW_BINS)
    loc = torch.randn(64, 1, LOCAL_VIEW_BINS)
    for cls in (SingleViewCNN, TwoViewCNN):
        torch.manual_seed(1)
        model = cls().eval()
        with torch.no_grad():
            z = model(g, loc)
        assert float(z.std()) > 1e-2, cls.__name__  # the output depends on the input
        assert float(z.abs().max()) < 2.0, cls.__name__  # ...and starts close to p = 0.5
        for m in model.modules():
            if isinstance(m, (nn.Conv1d, nn.Linear)):
                assert float(m.bias.detach().abs().max()) == 0.0
