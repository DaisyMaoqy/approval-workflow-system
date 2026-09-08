import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// 判断是否启用runes模式
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// 适配器
		adapter: adapter({
			out: 'build', // 构建输出目录
			precompress: true // 处理 Svelte 组件的 TS 和其他预处理
		})
	}
};

export default config;
