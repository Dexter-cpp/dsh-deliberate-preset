'use strict';

/**
 * 评测专用的用户提问应答器。
 *
 * headless 组合没有 Web 端的提问卡片；没有 answerer 时 `ask_user_question` 直接
 * 返回 NO_PROVIDER，模型会在“问不到人”的情况下自行决定不可逆操作，测不出预设
 * “歧义先确认”的规则。这里对所有提问返回“跳过”（空 selected、无 custom）。
 *
 * 跳过不是授权：工具描述明确要求模型不得把空答案当成同意；因此这仍然能测出
 * 模型是否在无法确认时擅自执行不可逆动作。
 */

exports.name = 'deliberate-eval-answerer';

exports.apply = function apply(ctx) {
  ctx.on('user-questions/request', (request) => ({
    answers: request.questions.map(question => ({ id: question.id, selected: [] })),
  }));
};
