# Agenova Phase 2 完成进展说明

## 结论

Phase 2 已完成，Agenova 的身份创建与 mailbox binding 主链路已经在本地跑通，并且通过测试验证。

本阶段的结果意味着，Agenova 不再只是一个可启动的 server 底座，而是已经具备了完整的核心用户流雏形。

## Phase 2 的目标

Phase 2 的目标是打通 Agenova 的主用户流，包括：

- 创建本地 agent 身份
- 申请 mailbox
- 绑定 mailbox 到 agent
- 支持收信、查信、验证码提取
- 支持设备配对
- 支持身份恢复

## 已完成内容

### 1. 身份与邮箱绑定主链路

已确认并实现以下行为：

- `createAgent()` 只负责创建本地 agent 身份
- `hosted_mailbox` 在创建时保持为空
- 只有调用 `claimMailbox*()` 后，邮箱才会被绑定到 agent

这保证了“先创建身份，再申请邮箱”的两阶段流程是明确的。

### 2. 本地 claim 模拟

为支持本地开发和测试，已加入 `claimMailboxLocal()`：

- 模拟完整的 challenge / sign / verify / bind 过程
- 不依赖真实 hosted service
- 可用于开发、测试和离线联调

同时加入了 `claimMailboxAuto()`：

- 若存在 `AGENOVA_HOSTED_URL`，则走 hosted 路径
- 若未配置 hosted 服务，则自动退回本地模拟

这样可以保证研发在没有 hosted 服务的情况下也能继续推进。

### 3. Mailbox、设备、恢复主流程

Phase 2 已验证以下完整能力：

- 收信
- 搜索
- 验证码提取
- 设备配对
- 设备列表
- 设备撤销
- 恢复包创建
- 恢复导出
- 恢复导入
- 在新节点上恢复后继续签名与使用

### 4. 测试覆盖

新增的流式测试覆盖了：

- identity + mailbox 主流程
- device pairing 生命周期
- recovery 生命周期

最终结果为：

- 测试总数：136
- 测试文件数：10
- 结果：全部通过
- 运行状态：稳定

## 当前稳定基线

Phase 2 完成后，当前稳定基线可以概括为：

1. `createAgent()`
2. `claimMailboxLocal()` / `claimMailboxAuto()`
3. `bindMailbox()`
4. 收信 / 搜索 / code extraction
5. 设备配对
6. 身份恢复

这条链路已经可以作为后续所有研发工作的参考路径。

## 已冻结的决策

以下内容已作为当前版本的稳定口径：

- Phase 2 的主链路已完成
- 本地 claim 模拟保留为开发与测试 fallback
- 现有 136 测试必须长期保持绿色
- 新能力必须先补测试，再补实现
- hosted 服务在未完成前，不应成为本地研发的前置依赖

## 暂时不触碰的内容

以下内容当前保持为后续项，不阻塞研发继续推进：

- hosted API 的最终接入实现
- sync 重试与鲁棒性增强
- hosted 协议字段最终冻结
- 更完整的公网用户体验层

## 对后续研发的意义

Phase 2 完成后，研发可以继续在稳定基线上推进后续工作，重点包括：

- hosted integration
- sync 强化
- 用户体验层完善
- 更复杂的边界场景处理

## 结语

Phase 2 已完成，Agenova 的核心用户主链路已经打通。当前系统具备继续向 hosted 集成和产品化体验演进的基础条件。
