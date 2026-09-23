# Blinded Post-Hoc Audit

For each UUID below, classify as `TRUE_SAFE` or `UNSAFE_ACCEPTANCE`.

## UUID: 2341b32a-6c10-40d3-91d1-2f2c5c64ee0d
### Context
```
NODE_A:
```tsx
<div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
      Proceed
    </div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: d70376d6-3993-406e-81d0-f5425f465c2b
### Context
```
NODE_A:
```tsx
<div id="c13-div" role="fake" onClick={() => {}}>Save</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 478b01e2-b929-423d-8640-ee27c2dae1bd
### Context
```
NODE_A:
```tsx
<img id="c1-img" src="/hero.png" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 421c05cf-44a1-4ebb-8664-c2d7d23c0751
### Context
```
NODE_A:
```tsx
<img id="c1-img" src="/hero.png" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 9a8d98d7-5371-4236-8e8c-1ffa2f33fb7f
### Context
```
NODE_A:
```tsx
<span id="c8-span">Search</span>
```
NODE_B:
```tsx
<input id="c8-input" type="text" aria-labelledby="wrong-id" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: d8ad7bab-bb9c-4504-a149-5a18518dd700
### Context
```
NODE_A:
```tsx
<img id="c1-img" src="/hero.png" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: d3521f77-c04b-4011-8862-2a7658aac1d4
### Context
```
NODE_A:
```tsx
<div id="c12-div" role="fake" onClick={() => {}}>Submit</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 92a4692a-474a-421a-9332-4d712b768de1
### Context
```
NODE_A:
```tsx
<div id="c13-div" role="fake" onClick={() => {}}>Save</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: a068a90a-b004-4302-8bc1-05d93e39e847
### Context
```
NODE_A:
```tsx
<label id="c6-label" htmlFor="wrong-email">Email</label>
```
NODE_B:
```tsx
<input id="c6-input" type="text" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: d4962c37-aa0e-4e5e-9ad3-a4e972749640
### Context
```
NODE_A:
```tsx
<img id="c1-img" src="/hero.png" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 9d63d386-0e75-4935-b45f-3ae7d5bb8a25
### Context
```
NODE_A:
```tsx
<div id="c12-div" role="fake" onClick={() => {}}>Submit</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 65239229-c3e1-4d3b-9521-a66a7bcc487c
### Context
```
NODE_A:
```tsx
<div id="c4-div" role="fake-role">Content</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 80e5a238-eaad-4cb2-9710-9ee6db87af6d
### Context
```
NODE_A:
```tsx
<div id="c12-div" role="fake" onClick={() => {}}>Submit</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: a96d8206-443f-46c8-b22d-b0a4d5b8dea9
### Context
```
NODE_A:
```tsx
<label id="c6-label" htmlFor="wrong-email">Email</label>
```
NODE_B:
```tsx
<input id="c6-input" type="text" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: ff1412f9-a72c-485d-a9f3-a92a39fa3569
### Context
```
NODE_A:
```tsx
<div id="c4-div" role="fake-role">Content</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 0e462ffe-fc88-403a-bf7a-9d21e219a0a1
### Context
```
NODE_A:
```tsx
<div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
      Proceed
    </div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 3e6c34fc-c017-4091-8441-4ce198965108
### Context
```
NODE_A:
```tsx
<div id="c4-div" role="fake-role">Content</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: bf043ede-b347-4df0-a717-483091bde28f
### Context
```
NODE_A:
```tsx
<label id="c6-label" htmlFor="wrong-email">Email</label>
```
NODE_B:
```tsx
<input id="c6-input" type="text" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 989f7c50-0161-45d9-b82c-6126fb37a59a
### Context
```
NODE_A:
```tsx
<button id="c2-btn"></button>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 5fe8b82f-1574-49e5-9e22-d84f353141ce
### Context
```
NODE_A:
```tsx
<div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
      Proceed
    </div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 99d92166-c629-46d0-9a2f-e7bc2ddd9280
### Context
```
NODE_A:
```tsx
<div id="c13-div" role="fake" onClick={() => {}}>Save</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 06a62f41-2cf8-4e45-a00b-a311c950614d
### Context
```
NODE_A:
```tsx
<button id="c2-btn"></button>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: df890ef2-3c58-49f7-8237-37346660f40b
### Context
```
NODE_A:
```tsx
<div id="c4-div" role="fake-role">Content</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 08b48d8f-c82d-4789-9db0-7bc09356538a
### Context
```
NODE_A:
```tsx
<label id="c6-label" htmlFor="wrong-email">Email</label>
```
NODE_B:
```tsx
<input id="c6-input" type="text" />
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 44b7360d-e151-41b1-8037-48a3025c50e0
### Context
```
NODE_A:
```tsx
<div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
      Proceed
    </div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 7aab4e13-4cd9-4c63-a8ff-632726ee1883
### Context
```
NODE_A:
```tsx
<div id="c12-div" role="fake" onClick={() => {}}>Submit</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

## UUID: 10f4509a-af8a-42b2-a097-3714c92d4ffb
### Context
```
NODE_A:
```tsx
<div id="c13-div" role="fake" onClick={() => {}}>Save</div>
```
```
### Classification
[ ] TRUE_SAFE
[ ] UNSAFE_ACCEPTANCE

