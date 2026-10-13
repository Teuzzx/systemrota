# Regras do R8/ProGuard para o build de release.
#
# O arquivo e referenciado por app/build.gradle.kts (proguardFiles) mesmo
# quando so o build de debug roda. Ausente, o AGP aborta na configuracao do
# modulo — entao ele existe e comecando vazio, que e a configuracao correta:
# as regras defaults do R8 dao conta de quase tudo.

# Room: os DAO gerados sao resolvidos por reflexao em tempo de execucao.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep @androidx.room.Entity class * { *; }
-dontwarn androidx.room.paging.**

# kotlinx.serialization: o serializador e gerado e acessado por reflexao.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Modelos do dominio: usados por reflexao no transporte.
-keep class com.rota.mobile.domain.model.** { *; }

# OkHttp nao empacota referencias a classes opcionais que ele nao usa.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**