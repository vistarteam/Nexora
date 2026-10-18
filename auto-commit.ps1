# Auto-Commit & Push Script with Confirmation

# ۱. بررسی اینکه آیا پوشه جاری یک مخزن گیت است یا خیر
if (!(Test-Path ".git")) {
    Write-Host "خطا: این پوشه یک مخزن گیت (Git Repository) نیست!" -ForegroundColor Red
    exit
}

# ۲. بررسی تغییرات جدید
$status = git status --porcelain

if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "هیچ تغییر جدیدی برای کامیت کردن وجود ندارد." -ForegroundColor Yellow
    exit
}

# ۳. نمایش فایل‌های تغییریافته به کاربر
Write-Host "فایل‌های زیر تغییر کرده‌اند:" -ForegroundColor Cyan
git status -s
Write-Host "----------------------------------------"

# ۴. گرفتن تاییدیه اولیه از کاربر
$confirm = Read-Host "آیا می‌خواهید این تغییرات کامیت و پوش شوند؟ (y/n)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "عملیات لغو شد." -ForegroundColor Yellow
    exit
}

# ۵. افزودن تمام تغییرات
git add .

# ۶. پیشنهاد پیام کامیت یا گرفتن پیام از کاربر
$defaultMsg = "Update files: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
$commitMsg = Read-Host "پیام کامیت را وارد کنید (Enter برای استفاده از پیام پیش‌فرض: '$defaultMsg')"

if ([string]::IsNullOrWhiteSpace($commitMsg)) {
    $commitMsg = $defaultMsg
}

# ۷. انجام کامیت
git commit -m "$commitMsg"

if ($LASTEXITCODE -eq 0) {
    Write-Host "کامیت با موفقیت انجام شد!" -ForegroundColor Green
    
    # ۸. پرسش برای پوش کردن روی گیت‌هاب
    $pushConfirm = Read-Host "آیا می‌خواهید تغییرات را به گیت‌هاب (Remote) پوش کنید؟ (y/n)"
    if ($pushConfirm -eq 'y' -or $pushConfirm -eq 'Y') {
        # دریافت نام برنچ فعلی
        $branch = git branch --show-current
        git push origin $branch
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "تغییرات با موفقیت روی گیت‌هاب آپلود شد!" -ForegroundColor Green
        } else {
            Write-Host "خطا در پوش کردن تغییرات. لطفاً اتصال اینترنت یا دسترسی‌ها را بررسی کنید." -ForegroundColor Red
        }
    }
} else {
    Write-Host "خطا در انجام کامیت." -ForegroundColor Red
}