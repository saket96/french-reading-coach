import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioFilenameForBlob, extensionForAudioMime, MIN_AUDIO_BLOB_BYTES } from './recordAudio.js'

test('extensionForAudioMime maps common recorder types', () => {
  assert.equal(extensionForAudioMime('audio/webm;codecs=opus'), 'webm')
  assert.equal(extensionForAudioMime('audio/ogg;codecs=opus'), 'ogg')
  assert.equal(extensionForAudioMime('audio/mp4'), 'm4a')
  assert.equal(extensionForAudioMime(''), 'webm')
})

test('audioFilenameForBlob uses blob mime', () => {
  assert.equal(audioFilenameForBlob({ type: 'audio/webm' }), 'reading.webm')
  assert.equal(audioFilenameForBlob({ type: 'audio/ogg;codecs=opus' }, 'clip'), 'clip.ogg')
})

test('MIN_AUDIO_BLOB_BYTES guards tiny Opera clips', () => {
  assert.ok(MIN_AUDIO_BLOB_BYTES >= 500)
})
