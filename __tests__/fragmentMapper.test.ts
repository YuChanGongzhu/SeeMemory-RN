import {fragmentToCard} from '../src/apis/mappers/fragment';
import type {MemoryFragment} from '../src/apis/requests/memory';


const fragment: MemoryFragment = {
  id: 'fragment-1',
  session_id: 'session-1',
  title: '周五行程',
  keywords: ['行程'],
  brief: '去了宝鸡',
  start_time: '2026-08-04 10:00:00',
  end_time: '2026-08-04 11:00:00',
  update_time: '2026-08-04 11:01:02',
  timeline: [
    {
      time: '10:30',
      content: '周五去了西安',
      type: 'audio',
      media_ids: ['audio-1'],
    },
  ],
  files: [
    {
      id: 'audio-1',
      url: 'https://example.com/audio.mp3',
      mime_type: 'audio/mpeg',
      file_name: '记录.mp3',
      description: null,
      tags: [],
      meta: {duration_ms: 61000},
      created_at: null,
    },
    {
      id: 'image-unreferenced',
      url: 'https://example.com/image.jpg',
      mime_type: 'image/jpeg',
      file_name: '照片.jpg',
      description: '旧图片',
      tags: [],
      meta: null,
      created_at: null,
    },
  ],
};


test('preserves backend timeline identity and exact fragment version for editing', () => {
  const card = fragmentToCard(fragment);
  expect(card.fragmentId).toBe('fragment-1');
  expect(card.fragmentUpdateTime).toBe('2026-08-04 11:01:02');
  expect(card.timelineRecords?.[0]).toMatchObject({
    type: 'audio',
    url: 'https://example.com/audio.mp3',
    duration: '1:01',
    timelineTarget: {
      index: 0,
      time: '10:30',
      type: 'audio',
      content: '周五去了西安',
      mediaIds: ['audio-1'],
    },
  });
});


test('keeps unreferenced legacy media visible but not editable', () => {
  const card = fragmentToCard(fragment);
  const legacyImage = card.timelineRecords?.find(record => record.url?.endsWith('image.jpg'));
  expect(legacyImage?.type).toBe('image');
  expect(legacyImage?.timelineTarget).toBeUndefined();
});


test('normalizes old timeline entries without type and media_ids', () => {
  const card = fragmentToCard({
    ...fragment,
    timeline: [{time: '10:30', content: '旧时间流文本'}],
    files: [],
  });
  expect(card.timelineRecords?.[0]).toMatchObject({
    type: 'text',
    content: '旧时间流文本',
    timelineTarget: {
      index: 0,
      time: '10:30',
      type: 'text',
      content: '旧时间流文本',
      mediaIds: [],
    },
  });
});
