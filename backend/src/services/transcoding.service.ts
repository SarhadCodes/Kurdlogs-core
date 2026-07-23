import { prisma } from '../config/database';
import { TRANSCODING_PRESETS } from '../config/constants';
import { AppError } from '../middleware/errorHandler';

class TranscodingService {
  async getAllProfiles() {
    return await prisma.transcodingProfile.findMany();
  }

  async getProfileById(id: string) {
    const profile = await prisma.transcodingProfile.findUnique({
      where: { id }
    });
    if (!profile) throw new AppError('Profile not found', 404);
    return profile;
  }

  async createProfile(data: any) {
    return await prisma.transcodingProfile.create({ data });
  }

  async updateProfile(id: string, data: any) {
    return await prisma.transcodingProfile.update({
      where: { id },
      data
    });
  }

  async deleteProfile(id: string) {
    // Check if in use
    const channels = await prisma.channel.findMany({ where: { transcodingProfileId: id } });
    if (channels.length > 0) {
       throw new AppError('Profile is in use by channels', 400);
    }
    return await prisma.transcodingProfile.delete({ where: { id } });
  }

  buildFfmpegArgs(profile: any, hasComplexFilter: boolean): string[] {
    const args: string[] = [];

    let height = -2;
    if (profile.resolution === 'RES_1080P') height = 1080;
    else if (profile.resolution === 'RES_720P') height = 720;
    else if (profile.resolution === 'RES_480P') height = 480;

    args.push('-c:v', profile.videoCodec);
    args.push('-preset', profile.preset);
    args.push('-b:v', profile.videoBitrate);
    args.push('-maxrate', profile.videoBitrate);
    
    // bufsize is typically 2x maxrate
    const bitrateVal = parseInt(profile.videoBitrate.replace('k', ''));
    args.push('-bufsize', `${bitrateVal * 2}k`);

    if (!hasComplexFilter) {
       args.push('-vf', `scale=-2:${height}`);
    } else {
       // If complex filter exists, scaling should ideally be done in the filter.
       // For simplicity, we just append a scale filter to the mapped output, but FFmpeg requires mapping logic.
       // The ffmpeg service will handle this basic case.
    }

    args.push('-r', profile.fps.toString());
    args.push('-c:a', profile.audioCodec);
    args.push('-b:a', profile.audioBitrate);
    args.push('-sc_threshold', '0');
    args.push('-g', (profile.fps * 2).toString());
    args.push('-keyint_min', profile.fps.toString());

    return args;
  }

  async seedDefaultProfiles() {
    const count = await prisma.transcodingProfile.count();
    if (count === 0) {
      for (const preset of TRANSCODING_PRESETS) {
        await prisma.transcodingProfile.create({
           data: {
              name: preset.name,
              resolution: preset.resolution as any,
              videoBitrate: preset.videoBitrate,
              audioBitrate: preset.audioBitrate,
              fps: preset.fps,
              isDefault: true
           }
        });
      }
    }
  }
}

export const transcodingService = new TranscodingService();
