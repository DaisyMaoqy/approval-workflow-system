import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite'; // 处理所有 Tailwind 语法
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			// 配置代理
			'^/aws': {
				target: 'http://localhost:3000', // 后端服务器地址
				changeOrigin: true,
				// rewrite: (path) => path.replace(/^/, ''),
				// secure: false, // 如果目标服务器是 HTTPS 但证书无效，设置为 false
        		// ws: true, // 支持 WebSocket
			}
		}
	},
	test: {
		expect: { requireAssertions: true }, // 要求每条测试都有except断言，expect.assertions(0); // 明确表示不要断言
		//  用projects包一层，是为了把那句resolve.conditions配置在测试范围内，不污染dev，build的模块解析
		projects: [
			{
				extends: './vite.config.ts',
				// 让svelte走browser导出条件，否则组件会出现无法挂载到jsdom
				resolve: { conditions: ['browser'] },
				test: {
					name: 'client',
					environment: 'jsdom', // 模拟DOM环境测试组件
					include: ['src/**/*.test.ts']
				}
			}
		]
	}
});
