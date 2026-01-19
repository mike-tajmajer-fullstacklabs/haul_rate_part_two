import { promises as fs } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import {
  DayType,
  Holiday,
  UserHoliday,
  HolidaysConfig,
  HolidaysConfigSchema,
} from '../types/index.js';

export class HolidayService {
  private configPath: string;
  private holidaysConfig: HolidaysConfig | null = null;

  constructor() {
    this.configPath = join(config.paths.config, 'holidays.json');
  }

  async init(): Promise<void> {
    await this.loadConfig();
  }

  private async loadConfig(): Promise<HolidaysConfig> {
    if (this.holidaysConfig) {
      return this.holidaysConfig;
    }

    const content = await fs.readFile(this.configPath, 'utf-8');
    this.holidaysConfig = HolidaysConfigSchema.parse(JSON.parse(content));
    return this.holidaysConfig;
  }

  private async saveConfig(): Promise<void> {
    if (!this.holidaysConfig) {
      throw new Error('Holiday config not loaded');
    }
    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.holidaysConfig, null, 2),
      'utf-8'
    );
  }

  private getFixedHolidayDate(year: number, month: number, day: number): Date {
    return new Date(year, month - 1, day);
  }

  private getFloatingHolidayDate(
    year: number,
    month: number,
    weekday: number,
    occurrence: number
  ): Date {
    const firstOfMonth = new Date(year, month - 1, 1);
    const lastOfMonth = new Date(year, month, 0);

    if (occurrence === -1) {
      // Last occurrence of the weekday in the month
      let date = new Date(lastOfMonth);
      while (date.getDay() !== weekday) {
        date.setDate(date.getDate() - 1);
      }
      return date;
    }

    // Find the first occurrence of the weekday
    let date = new Date(firstOfMonth);
    while (date.getDay() !== weekday) {
      date.setDate(date.getDate() + 1);
    }

    // Move to the nth occurrence
    date.setDate(date.getDate() + (occurrence - 1) * 7);

    return date;
  }

  private getHolidayDate(holiday: Holiday, year: number): Date {
    if (holiday.type === 'fixed') {
      return this.getFixedHolidayDate(year, holiday.month, holiday.day);
    } else {
      return this.getFloatingHolidayDate(
        year,
        holiday.month,
        holiday.weekday,
        holiday.occurrence
      );
    }
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async isFederalHoliday(date: Date): Promise<{ isHoliday: boolean; name?: string }> {
    const config = await this.loadConfig();
    const year = date.getFullYear();
    const dateStr = this.formatDate(date);

    for (const holiday of config.federalHolidays) {
      const holidayDate = this.getHolidayDate(holiday, year);
      if (this.formatDate(holidayDate) === dateStr) {
        return { isHoliday: true, name: holiday.name };
      }
    }

    return { isHoliday: false };
  }

  async isUserHoliday(date: Date): Promise<{ isHoliday: boolean; name?: string }> {
    const config = await this.loadConfig();
    const dateStr = this.formatDate(date);

    const userHoliday = config.userHolidays.find((h) => h.date === dateStr);
    if (userHoliday) {
      return { isHoliday: true, name: userHoliday.name };
    }

    return { isHoliday: false };
  }

  async getDayType(date: Date): Promise<{
    type: DayType;
    holidayName?: string;
  }> {
    // Check user holidays first (takes precedence)
    const userHoliday = await this.isUserHoliday(date);
    if (userHoliday.isHoliday) {
      return { type: 'holiday', holidayName: userHoliday.name };
    }

    // Check federal holidays
    const federalHoliday = await this.isFederalHoliday(date);
    if (federalHoliday.isHoliday) {
      return { type: 'holiday', holidayName: federalHoliday.name };
    }

    // Check weekend (Sunday = 0, Saturday = 6)
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { type: 'weekend' };
    }

    return { type: 'weekday' };
  }

  async getHolidaysForYear(year: number): Promise<
    Array<{
      date: string;
      name: string;
      type: 'federal' | 'user';
    }>
  > {
    const config = await this.loadConfig();
    const holidays: Array<{ date: string; name: string; type: 'federal' | 'user' }> =
      [];

    // Add federal holidays
    for (const holiday of config.federalHolidays) {
      const date = this.getHolidayDate(holiday, year);
      holidays.push({
        date: this.formatDate(date),
        name: holiday.name,
        type: 'federal',
      });
    }

    // Add user holidays for the year
    for (const holiday of config.userHolidays) {
      if (holiday.date.startsWith(String(year))) {
        holidays.push({
          date: holiday.date,
          name: holiday.name,
          type: 'user',
        });
      }
    }

    // Sort by date
    holidays.sort((a, b) => a.date.localeCompare(b.date));

    return holidays;
  }

  async addUserHoliday(holiday: UserHoliday): Promise<void> {
    const config = await this.loadConfig();

    // Check if holiday already exists
    const exists = config.userHolidays.some((h) => h.date === holiday.date);
    if (exists) {
      throw new Error(`User holiday already exists for date: ${holiday.date}`);
    }

    config.userHolidays.push(holiday);
    config.userHolidays.sort((a, b) => a.date.localeCompare(b.date));

    await this.saveConfig();
  }

  async removeUserHoliday(date: string): Promise<boolean> {
    const config = await this.loadConfig();

    const index = config.userHolidays.findIndex((h) => h.date === date);
    if (index === -1) {
      return false;
    }

    config.userHolidays.splice(index, 1);
    await this.saveConfig();

    return true;
  }

  async getUserHolidays(): Promise<UserHoliday[]> {
    const config = await this.loadConfig();
    return [...config.userHolidays];
  }
}

// Singleton instance
export const holidayService = new HolidayService();
