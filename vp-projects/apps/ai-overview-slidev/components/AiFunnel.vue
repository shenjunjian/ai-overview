<script setup lang="ts">
const props = withDefaults(
  defineProps<{ highlight?: 'app' | 'agent' | 'model' | 'none' }>(),
  { highlight: 'none' },
)

const strong: Record<string, string> = {
  app: '#a5d3f2',
  agent: '#abe3b8',
  model: '#f6d8a8',
}
const pale: Record<string, string> = {
  app: '#eaf3fb',
  agent: '#eef8f0',
  model: '#fdf7ec',
}
const fill = (key: 'app' | 'agent' | 'model') =>
  props.highlight === key ? strong[key] : pale[key]
</script>

<template>
  <svg viewBox="0 0 470 430" class="h-full w-full" role="img" aria-label="AI 三层漏斗">
    <defs>
      <marker id="funnel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
      </marker>
    </defs>
    <polygon :fill="fill('app')" stroke="#4b5563" stroke-width="2" points="30,10 430,10 361.7,150 98.3,150" />
    <polygon :fill="fill('agent')" stroke="#4b5563" stroke-width="2" points="98.3,150 361.7,150 293.4,290 166.6,290" />
    <polygon :fill="fill('model')" stroke="#4b5563" stroke-width="2" points="166.6,290 293.4,290 254.4,370 205.6,370" />
    <polygon fill="#ffffff" stroke="#4b5563" stroke-width="2" points="205.6,370 254.4,370 230,420" />
    <text x="230" y="88" text-anchor="middle" style="font-size: 26px">AI 应用</text>
    <text x="230" y="228" text-anchor="middle" style="font-size: 22px">智能体开发</text>
    <text x="230" y="336" text-anchor="middle" style="font-size: 16px">大模型</text>
    <line x1="252" y1="345" x2="316" y2="392" stroke="#4b5563" stroke-width="2" marker-end="url(#funnel-arrow)" />
    <rect x="326" y="378" width="120" height="40" rx="6" fill="#a5d3f2" stroke="#4b5563" stroke-width="2" />
    <text x="386" y="404" text-anchor="middle" style="font-size: 18px">硬件/算法</text>
  </svg>
</template>