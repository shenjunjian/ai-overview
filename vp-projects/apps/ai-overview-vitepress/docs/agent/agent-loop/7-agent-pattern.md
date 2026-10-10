# 7种主流AI Agent架构全解析

[b站链接](https://www.bilibili.com/video/BV1Lnaw6JEfr)

1.  单agent , 同一个上下文不断循环
2.  ReAct 模式， 其实同上面一样的循环
3.  Plan 模式， 先规划，再执行 ----- 分析任务，拆解步骤，生成计划，任务执行，校验结果
4.  多Agent + 调度模式 ----- 多个上下文代替单一上下文
5.  Router + skill模式 ----- 先经过`意图路由器`进行一次任务路由（应该是类似AI IDE中的` plan, agent` 模式选择，选择后进入某个skill 指导任务完成 ）
6.  黑板系统 Blackboard system ----- 多个agent 共享同一个状态（像黑板一样）， 状态一变，就驱动下一步。 状态管理复杂
7.  图工作流 Graph workflow ----- 使用有向无环图来编排， 重量级，支持分支，并行，可回溯，可重试
