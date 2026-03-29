# Agenova Phase 1 完成进展说明

## 结论

Phase 1 已完成，当前可以作为 server 研发的稳定基线继续向后推进。

本阶段的重点不是业务扩展，而是先把最关键的基础能力补齐，确保后续模块可以在一个可测试、可回归、可复用的底座上开发。

## Phase 1 的目标

Phase 1 的目标是为 Agenova server 建立基础研发能力，包括：

- 可测试的 app factory
- 数据库与密钥状态的测试隔离
- identity / auth / policy 等核心路径的单元测试
- 基础路由的集成测试能力
- 为后续 Phase 2 及以后模块提供稳定底座

## 已完成内容

### 1. 测试基础设施

- 已补齐 `createApp()` 工厂
- `index.ts` 只保留启动壳，不再承载业务逻辑
- 已提供数据库与 master key 的 reset 能力
- 已建立测试 helper，支持：
  - 测试 agent 创建
  - 签名请求构造
  - scope 授权
  - 内存数据库隔离

### 2. 核心单元测试

已完成对以下核心路径的覆盖：

- identity
- auth middleware
- policy middleware
- crypto
- memory
- model keys

### 3. 路由层测试

已完成基础路由层的验证，覆盖：

- identity 路由
- mailbox 路由
- memory 路由
- 相关公共接口和错误分支

### 4. 已发现并修复的问题

Phase 1 过程中，测试帮助发现并修复了两个真实问题：

- 请求签名构造时对 query string 的处理不一致
- `/inbox/code` 与动态路由匹配顺序冲突

这说明测试底座已经开始发挥回归保护作用。

## 当前结果

- 测试总数：113
- 测试文件数：7
- 结果：全部通过
- 运行状态：稳定

## 当前可依赖的能力

Phase 1 结束后，团队可以稳定依赖以下能力继续开发：

- 本地启动 server
- 创建 agent
- 鉴权与授权校验
- 读写 memory
- 基础 mailbox 能力
- 基础加密与签名能力
- 测试可重复执行

## 需要注意的边界

Phase 1 不是完整产品阶段，当前仍然不包含：

- hosted mailbox 的完整公网接入
- `@agenova.chat` 的最终 hosted 协议冻结
- 更完整的用户体验层
- 更复杂的同步与容错策略

## 对后续研发的意义

Phase 1 完成后，后续研发可以在以下原则下继续：

1. 每次新改动必须先保持现有测试全绿
2. 新能力必须先补测试，再补实现
3. 不允许破坏当前 server 的测试隔离与启动边界

## 结语

Phase 1 已完成，可以作为 Agenova server 的稳定工程底座，继续进入 Phase 2 及后续功能开发。
