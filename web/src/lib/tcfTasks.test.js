import test from 'node:test'
import assert from 'node:assert/strict'
import { listLibraryTcfTasks, TCF_CATEGORIES, categoryMeta } from './tcfTasks.js'

test('library TCF tasks cover EE and orale categories', () => {
  const tasks = listLibraryTcfTasks()
  assert.ok(tasks.length >= 8)
  const cats = new Set(tasks.map((t) => t.category))
  assert.ok(cats.has('ee1') || cats.has('ee2') || cats.has('ee3'))
  assert.ok(cats.has('orale'))
  for (const task of tasks) {
    assert.ok(task.id)
    assert.ok(task.title)
    assert.ok(task.text?.length > 40)
    assert.equal(task.solved, true)
  }
})

test('categoryMeta resolves known ids', () => {
  assert.equal(TCF_CATEGORIES.length, 5)
  assert.match(categoryMeta('orale').label, /Orale/)
  assert.equal(categoryMeta('nope'), null)
})
