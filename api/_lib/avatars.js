const { r, bad } = require('./core');

const PREFIX = 'data:image/jpeg;base64,';
const MAX_BYTES = 16 * 1024;
const SIZE = 96;

function validateAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) ||
      value.length > PREFIX.length + 4 * Math.ceil(MAX_BYTES / 3)) throw bad('Choose a smaller profile picture.');
  const encoded = value.slice(PREFIX.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 12 || bytes.length > MAX_BYTES || bytes.toString('base64') !== encoded ||
      bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw bad('This profile picture could not be read.');
  }

  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ((marker === 0xc0 || marker === 0xc2) && length >= 8 &&
        bytes.readUInt16BE(offset + 3) === SIZE && bytes.readUInt16BE(offset + 5) === SIZE) return value;
    offset += length;
  }
  throw bad('This profile picture could not be read.');
}

// Resolve by the stored winning ticket so username changes cannot transfer a photo.
const WINNER_AVATARS = `
local photos = {}
for i = 1, #ARGV do
  local number = tonumber(ARGV[i])
  local raw = redis.call('LINDEX', KEYS[1], number - 1)
  local photo = false
  if raw then
    local ok, ticket = pcall(cjson.decode, raw)
    if ok and type(ticket) == 'table' and ticket.n == number and type(ticket.uid) == 'string' then
      photo = redis.call('HGET', KEYS[2], ticket.uid)
    end
  end
  photos[i] = photo or false
end
return photos
`;

async function addWinnerAvatars(draw) {
  if (!draw?.winners?.length) return;
  const photos = await r('EVAL', WINNER_AVATARS, 2, 'tickets:' + draw.id, 'avatars', ...draw.winners.map((winner) => winner.n));
  draw.winners.forEach((winner, index) => {
    if (photos[index]) winner.avatar = photos[index];
  });
}

module.exports = { validateAvatar, addWinnerAvatars };
