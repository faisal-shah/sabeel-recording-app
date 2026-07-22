# Firebase Recording Cost Research

## Summary

At the corrected expected scale, Firebase/GCS recording storage and playback should be free or very close to free.

Assumptions:

- 15 two-hour recordings published per month.
- Audio-only M4A/AAC files, not video.
- 20 students.
- Each student listens to each recording twice.
- Baseline Zoom-style audio estimate: 32 kbps.
- Firebase Storage / GCS bucket in a no-cost-quota-eligible US region.

## Source links

- [Firebase pricing](https://firebase.google.com/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Firebase Storage billing changes FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Zoom cloud recording storage capacity](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067670)

## Pricing rows used

For modern Firebase Storage buckets such as `*.firebasestorage.app` and additional buckets, the Firebase pricing page showed:

| Resource | No-cost quota | After no-cost quota |
|---|---:|---|
| Stored data | 5 GB-months | Cloud Storage pricing |
| Downloaded data | 100 GB/month | Cloud Storage pricing |
| Upload operations | 5K/month | Cloud Storage pricing |
| Download operations | 50K/month | Cloud Storage pricing |

Firebase notes that the no-cost quotas for these buckets are only available in:

- `us-central1`
- `us-west1`
- `us-east1`

Cloud Storage pricing used for the estimate:

| Resource | Price used |
|---|---:|
| US Standard storage | about $0.020/GiB-month |
| General internet egress to worldwide destinations excluding Asia and Australia | $0.12/GiB for the first 10 TiB |
| Standard storage Class B operations | $0.0004 per 1,000 operations |

Legacy `*.appspot.com` Firebase Storage buckets have different rows on the Firebase pricing page: 5 GB stored and 1 GB/day downloaded, then $0.026/GB stored and $0.12/GB downloaded. Prefer a modern bucket in a qualifying US region for this project.

## Baseline calculation

Audio size:

```text
32 kbps = 4 KB/s
2 hours = 7,200 seconds
4 KB/s * 7,200 seconds = 28,800 KB
28,800 KB = about 28.8 MB = about 0.0268 GiB
```

Monthly usage:

| Item | Calculation | Result |
|---|---:|---:|
| Size per recording | 32 kbps × 7,200 sec | ~28.8 MB, ~0.0268 GiB |
| Storage added per month | 15 × 0.0268 GiB | **0.40 GiB/month** |
| Total listens | 15 recordings × 20 students × 2 listens | **600 plays/month** |
| Playback egress | 0.40 GiB × 40 total listens/recording | **16.1 GiB/month** |

## Cost estimate

| Cost component | Usage | No-cost quota | Billable | Estimated cost |
|---|---:|---:|---:|---:|
| Storage | 0.40 GiB-month | 5 GiB-month | 0 | **$0** |
| Downloads / egress | 16.1 GiB/month | 100 GiB/month | 0 | **$0** |
| Upload operations | 15/month | 5K/month | 0 | **$0** |
| Download operations | ~600/month if one request per listen | 50K/month | 0 | **$0** |

Expected recording-only Firebase/GCS cost: **$0/month** at this scale.

## Sensitivity by bitrate

| Audio bitrate | Storage added/month | Playback egress/month | Expected cost |
|---:|---:|---:|---:|
| 32 kbps | ~0.40 GiB | ~16.1 GiB | **$0** |
| 64 kbps | ~0.80 GiB | ~32.2 GiB | **$0** |
| 128 kbps | ~1.61 GiB | ~64.4 GiB | **$0** |

Even at 128 kbps, this remains below the 5 GiB-month storage quota and 100 GB/month download quota.

## When costs would start to matter

Costs become material if any of these change:

- Video MP4 is stored or streamed instead of audio-only M4A.
- The number of students grows significantly.
- Students replay recordings many more times.
- Recordings are retained for many years without lifecycle policies.
- Audio is served through Functions instead of directly from Firebase Storage/GCS.
- The bucket is not in a no-cost-quota-eligible region.
- The app supports offline downloads that repeatedly re-download instead of caching locally.

## Implementation recommendation

- Store only audio-only M4A/AAC files.
- Put the Storage bucket in `us-central1`, `us-west1`, or `us-east1`.
- Use Firebase Storage/GCS directly for playback, protected by Firebase Security Rules or short-lived signed URLs.
- Do not proxy long audio streams through Cloud Functions.
- Add lifecycle rules for old recordings once retention policy is known.
- Cache audio locally in the mobile app when allowed so repeated listens do not consume additional bandwidth.

