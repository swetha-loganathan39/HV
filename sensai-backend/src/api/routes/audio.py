import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

from api.settings import settings

router = APIRouter()


@router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not settings.elevenlabs_api_key:
        raise HTTPException(
            status_code=500,
            detail="ElevenLabs API key not configured",
        )

    try:
        url = "https://api.elevenlabs.io/v1/speech-to-text"
        headers = {"xi-api-key": settings.elevenlabs_api_key}

        content = await file.read()
        files = {"file": (file.filename, content, file.content_type)}
        data = {
            "model_id": "scribe_v1",
            "tag_audio_events": "true",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                headers=headers,
                files=files,
                data=data,
            )

            if response.status_code != 200:
                logging.error("ElevenLabs STT error: %s", response.text)
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"ElevenLabs error: {response.text}",
                )

            result = response.json()
            return {"transcript": result.get("text", "")}

    except Exception as exc:
        logging.error("Transcription error: %s", str(exc))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to transcribe: {str(exc)}",
        )
