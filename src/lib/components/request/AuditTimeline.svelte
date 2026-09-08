<script lang="ts">
	import type { AuditEntry } from '$lib/domain/types';
	import { ACTION_LABELS, STATUS_LABELS } from '$lib/domain/workflow';
	// 时间格式化统一走 formatDateTime：时间戳字面量即中国时间（+08:00），直接截取即可
	import { formatDateTime } from '$lib/format/date';

	interface Props {
		audit: AuditEntry[];
	}

	let { audit }: Props = $props();

	// 防御性按时间升序渲染：领域层约定 audit 已正序，这里再排一次更稳，
	// 避免某条数据被手改过顺序后时间线倒挂。
	const entries = $derived([...audit].sort((a, b) => a.at.localeCompare(b.at)));

/** ISO → `YYYY-MM-DD HH:mm`（按中国时区字面量，与 formatDateTime 口径一致） */
function toDateTime(iso: string): string {
	return formatDateTime(iso);
}
</script>

<ol class="timeline">
	{#each entries as entry (entry.id)}
		<li class="timeline__item">
			<div class="timeline__rail" aria-hidden="true">
				<span class="timeline__dot"></span>
			</div>
			<div class="timeline__body">
				<p class="timeline__head">
					<span class="timeline__actor">{entry.actorName}</span>
					<span class="timeline__action">{ACTION_LABELS[entry.action]}</span>
					<span class="timeline__flow">
						{STATUS_LABELS[entry.from]}
						<span class="timeline__arrow" aria-hidden="true">→</span>
						{STATUS_LABELS[entry.to]}
					</span>
				</p>
				{#if entry.comment}
					<p class="timeline__comment">{entry.comment}</p>
				{/if}
				<p class="timeline__time">{toDateTime(entry.at)}</p>
			</div>
		</li>
	{/each}
</ol>

<style>
	.timeline {
		/* 去掉默认列表样式，时间线由 rail 自行绘制竖线 */
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.timeline__item {
		display: grid;
		grid-template-columns: 1.25rem 1fr;
		gap: 0.75rem;
	}
	.timeline__rail {
		/* 竖线：相对定位的容器里画一条贯穿的线，圆点压在线上 */
		position: relative;
		display: flex;
		justify-content: center;
	}
	.timeline__rail::before {
		content: '';
		position: absolute;
		top: 0.5rem;
		bottom: -0.75rem;
		width: 1px;
		background-color: var(--color-slate-200);
	}
	/* 末项不再向下延伸竖线 */
	.timeline__item:last-child .timeline__rail::before {
		display: none;
	}
	.timeline__dot {
		position: relative;
		margin-top: 0.3rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background-color: var(--color-brand-500);
	}
	.timeline__body {
		padding-bottom: 1.25rem;
	}
	.timeline__item:last-child .timeline__body {
		padding-bottom: 0;
	}
	.timeline__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}
	.timeline__actor {
		font-weight: 600;
		color: var(--color-slate-900);
	}
	.timeline__action {
		font-size: 0.8125rem;
		color: var(--color-slate-700);
	}
	.timeline__flow {
		font-size: 0.75rem;
		color: var(--color-slate-500);
	}
	.timeline__arrow {
		margin: 0 0.25rem;
	}
	.timeline__comment {
		margin-top: 0.375rem;
		border-left: 2px solid var(--color-slate-200);
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-slate-600);
		background-color: var(--color-slate-50);
		border-radius: 0 0.375rem 0.375rem 0;
	}
	.timeline__time {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-slate-400);
	}
</style>
