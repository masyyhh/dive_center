export const roomNumberHelp = 'Enter a room number using 1–32 digits only.';
export const isRoomNumber = (value: string) => /^[0-9]{1,32}$/.test(value.trim());
export const isPositiveInt = (value: number) => Number.isInteger(value) && value > 0 && value <= 2147483647;
