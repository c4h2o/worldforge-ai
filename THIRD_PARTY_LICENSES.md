# Third-Party Licenses

WorldForge AI uses the following third-party components, each under its own
license (all MIT). These portions are **not** governed by the WorldForge AI
Non-Commercial License; their terms (including the requirement to retain the
copyright and permission notice in all copies or substantial portions) must be
honored.

## TripoSR
- Source: https://github.com/VAST-AI-Research/TripoSR
- License: MIT (Copyright (c) 2024 VAST-AI-Research and contributors)
- Used as: image-to-3D fast path (SelfHostProvider)

## TripoSG
- Source: https://github.com/VAST-AI-Research/TripoSG
- License: MIT (Copyright (c) 2025 VAST-AI-Research and contributors)
- Used as: image-to-3D high-fidelity path (SelfHostProvider)

## TripoSF
- Source: https://github.com/VAST-AI-Research/TripoSF
- License: MIT (Copyright (c) 2025 VAST-AI-Research and contributors)
- Used as: differentiable mesh / postprocess (SelfHostProvider)

## @tripo3d/sdk (tripo-js-sdk)
- Source: https://github.com/VAST-AI-Research/tripo-js-sdk
- License: MIT
- Used as: optional Tripo commercial API client (TripoProvider)

---
Note: The **Tripo commercial API** (openapi.tripo3d.ai) is a service governed by
Tripo's Terms of Service, not an MIT-licensed component. See docs/LICENSING.md.
