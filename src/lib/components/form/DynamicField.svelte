<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { FieldDef } from '$lib/domain/applicationTypes';
	import type { ApplicationType } from '$lib/domain/types';
	import Field from './Field.svelte';
	import { centsToYuan, parseYuanInput } from '$lib/domain/money';
	import { polishText } from '$lib/data/requests';

	interface Props {
		field: FieldDef;
		scopeValue: Record<string, unknown>;
		scopePatch: (key: string, value: unknown) => void;
		basePath?: string;
		errors?: Record<string, string>;
		/** 已交互过的字段路径集合（点号路径，与 errors 的 key 对齐）。用于「实时校验」：只展示动过的字段错误 */
		touched?: Record<string, boolean>;
		/** 用户点击过「下一步/提交」后，强制展示所有错误（忽略 touched） */
		attempted?: boolean;
		/** 标记某字段路径已被用户交互过 */
		markTouched?: (path: string) => void;
		children?: Snippet;
		isPolishing?: boolean;
		isEnough?: boolean;
		type?: ApplicationType;
	}

	let {
		field,
		scopeValue,
		scopePatch,
		basePath = '',
		errors = {},
		touched = {},
		attempted = false,
		markTouched = () => {},
		children,
		isPolishing = false,
		isEnough = false,
		type,
	}: Props = $props();

	// 统一接口：每个渲染器都拿到「当前作用域的值对象」与「写入某 key 的回调」。
	// 基础字段读写 field.key；dateRange 直接写 fromKey/toKey 到同一作用域。
	const errorFor = (key: string) => (basePath ? errors[`${basePath}${key}`] : errors[key]) ?? '';
	const childPath = (key: string) => (basePath ? `${basePath}${key}` : key);

	const value = $derived(scopeValue[field.key]);

	// dateRange 跨两个输入框：错误可能挂在 fromKey 或 toKey 上，二者分别记录 touched。
	const primaryPath = $derived(
		field.kind === 'dateRange' ? childPath(field.toKey) : childPath(field.key)
	);
	const altPath = $derived(field.kind === 'dateRange' ? childPath(field.fromKey) : '');

	/**
	 * 决定某字段当前应展示的错误文案。
	 * - 已点击提交/下一步（attempted）：优先展示主路径错误，其次展示 alt 路径（如 dateRange 的 from）。
	 * - 否则仅在对应路径被 touched 后展示，避免初次进入/未交互就满屏红字。
	 */
	function revealError(primary: string, alt: string): string {
		if (attempted) return errorFor(primary) || (alt ? errorFor(alt) : '') || '';
		if (touched[primary]) {
			const e = errorFor(primary);
			if (e) return e;
		}
		if (alt && touched[alt]) {
			const e = errorFor(alt);
			if (e) return e;
		}
		return '';
	}

	const fieldError = $derived(revealError(primaryPath, altPath));

	// 字段失焦即视为「已交互」，之后错误随输入实时更新；dateRange 两个框各自标记。
	// 输入（oninput）时也标记 touched：让错误在「首次输入过程中」就实时出现，
	// 不必等到失焦——满足「输入中也要实时校验」的交互。
	function touch(): void {
		markTouched(primaryPath);
	}
	function touchAlt(): void {
		if (altPath) markTouched(altPath);
	}

	// 金额字段：UI 输入「元」，领域层存「分」。用本地文本态避免逐字符输入被格式化覆盖。
	let moneyText = $state('');
	let moneyInput = $state<HTMLInputElement | null>(null);
	$effect(() => {
		const cents = scopeValue[field.key];
		if (moneyInput && document.activeElement === moneyInput) return;
		moneyText = cents == null ? '' : String(centsToYuan(cents as number));
		updateIsEnough();
	});
	function onMoneyInput(event: Event) {
		const text = (event.currentTarget as HTMLInputElement).value;
		moneyText = text;
		const cents = parseYuanInput(text);
		scopePatch(field.key, cents ?? undefined);
		touch();
	}

	async function aiPolish() {
		const curValue = scopeValue[field.key] as string;
		isPolishing = true;

		if (!curValue || !curValue.trim()) {
			alert('请先输入需要润色的内容');
			isPolishing = false;
			return;
		}
		if (!type) {
			alert('该字段暂不支持 AI 润色');
			isPolishing = false;
			return;
		}

		try {
			/** ai/polish  post polishText
			 *  申请类型 
			 *  type: string;
			 *   待润色的申请内容 
			 *  content: string;
			*/
			const res = await polishText({
				type,
				content: curValue
			});
			
			if (!res?.success) {
				alert(res?.error || '润色失败，请稍后重试');
				return;
			}
			// 更新值
			const polishedContent = res?.polished || curValue;
			scopePatch(field.key, polishedContent);
			touch();
			
		} catch (error) {
			console.error('润色失败:', error);
			alert(`润色失败: ${error}`);
		} finally {
			isPolishing = false;
		}
	}
	// 更新字段长度是否满足要求
	function updateIsEnough() {
		if (field.kind === 'textarea') {
			const _value = scopeValue[field.key] as string;
			if (_value && (_value.length < 10 || _value.length > 200)) isEnough = false;
			else isEnough = true;
		}
	}
		// 渲染时判断
		updateIsEnough()
	})
</script>

{#if field.kind === 'text' || field.kind === 'textarea'}
	<Field label={field.label} required={field.required} error={fieldError} hint={field.hint}>
		{#if field.kind === 'textarea'}
			<textarea
				class="input"
				rows="4"
				placeholder={field.placeholder}
				value={String(value ?? '')}
				oninput={(e) => {
					scopePatch(field.key, e.currentTarget.value);
					if (e.currentTarget.value.length < 10 || e.currentTarget.value.length > 200) isEnough = false;
					else isEnough = true;
					touch();
				}}
				disabled={isPolishing}
				onblur={touch}></textarea>
			<button
				type="button"
				class="w-25 btn btn--primary"
				onclick={aiPolish}
				disabled={isPolishing || !isEnough}
			>
				{#if isPolishing}
					润色中...
				{:else}
					一键润色
				{/if}
			</button>
		{:else}
			<input
				class="input"
				type="text"
				placeholder={field.placeholder}
				value={String(value ?? '')}
				oninput={(e) => {
					scopePatch(field.key, e.currentTarget.value);
					touch();
				}}
				onblur={touch}
			/>
		{/if}
	</Field>
{:else if field.kind === 'number'}
	<Field label={field.label} required={field.required} error={fieldError} hint={field.hint}>
		<input
			class="input"
			type="text"
			inputmode="decimal"
			bind:this={moneyInput}
			placeholder={field.placeholder ?? (field.money ? '单位：元' : undefined)}
			value={moneyText}
			oninput={onMoneyInput}
			onblur={touch}
		/>
		{#if field.unit && !field.money}<span class="field__unit">{field.unit}</span>{/if}
	</Field>
{:else if field.kind === 'date'}
	<Field label={field.label} required={field.required} error={fieldError}>
		<input
			class="input"
			type="date"
			value={String(value ?? '')}
			oninput={(e) => {
				scopePatch(field.key, e.currentTarget.value);
				touch();
			}}
			onblur={touch}
		/>
	</Field>
{:else if field.kind === 'dateRange'}
	<Field label={field.label} required={field.required} error={fieldError}>
		<div class="date-range">
			<input
				class="input"
				type="date"
				value={String(scopeValue[field.fromKey] ?? '')}
				oninput={(e) => {
					scopePatch(field.fromKey, e.currentTarget.value);
					touchAlt();
				}}
				onblur={touchAlt}
				aria-label={`${field.label}开始`}
			/>
			<span class="date-range__sep" aria-hidden="true">至</span>
			<input
				class="input"
				type="date"
				value={String(scopeValue[field.toKey] ?? '')}
				oninput={(e) => {
					scopePatch(field.toKey, e.currentTarget.value);
					touch();
				}}
				onblur={touch}
				aria-label={`${field.label}结束`}
			/>
		</div>
	</Field>
{:else if field.kind === 'select' || field.kind === 'radio'}
	<Field label={field.label} required={field.required} error={fieldError}>
		{#if field.kind === 'radio'}
			<div class="radio-group">
				{#each field.options as opt (opt.value)}
					<label class="radio">
						<input
							type="radio"
							name={childPath(field.key)}
							value={opt.value}
							checked={value === opt.value}
							onchange={() => {
								scopePatch(field.key, opt.value);
								touch();
							}}
						/>
						{opt.label}
					</label>
				{/each}
			</div>
		{:else}
			<select
				class="input"
				value={String(value ?? '')}
				onchange={(e) => {
					scopePatch(field.key, e.currentTarget.value);
					touch();
				}}
			>
				<option value="" disabled selected={!value}>请选择</option>
				{#each field.options as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		{/if}
	</Field>
{:else if field.kind === 'group' || field.kind === 'repeatable'}
	<!-- group/repeatable 由 DynamicForm 委托给专用组件，这里不应被直接渲染 -->
{:else if field.kind === 'custom'}
	<Field label={field.label} error={fieldError}>
		{#if children}{@render children()}{/if}
	</Field>
{/if}

<style>
	.input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-slate-300);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		background: var(--color-white);
	}
	.input:focus {
		outline: 2px solid var(--color-brand-300);
		border-color: var(--color-brand-500);
	}
	textarea.input {
		resize: vertical;
		font-family: inherit;
	}
	.date-range {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.date-range__sep {
		color: var(--color-slate-500);
	}
	.radio-group {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.radio {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
	}
	.field__unit {
		margin-left: 0.5rem;
		color: var(--color-slate-500);
		font-size: 0.875rem;
	}
</style>
